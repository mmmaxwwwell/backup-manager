const storage = require('node-persist');
const moment = require('moment')
const { debug } = require('./debug')
const fs = require('fs');
const archiver = require('archiver')
const AWS = require('aws-sdk')
const s3 = new AWS.S3();
s3.endpoint = process.env.S3_ENDPOINT
// process.env.DEBUG = "true"
let dryRun = false
let timer
let firstRun

const defaultBackupStrategy = [
  {
    name: 'one-min',
    frequency: 15,
    unit: 'seconds',
    offsite: false,
    retainCount: 2
  },
  // {
  //   name: 'two-min',
  //   frequency: 2,
  //   unit: 'minute',
  //   offsite: false,
  //   retainCount: 2
  // },
  // {
  //   name: 'four-min',
  //   frequency: 4,
  //   unit: 'minute',
  //   offsite: false,
  //   retainCount: 2
  // }
]

// const defaultBackupStrategy = [
//   {
//     name: 'hourly-local',
//     frequency: 1,
//     units: 'hour',
//     offsite: false,
//     retainCount: 24
//   },
//   {
//     name: '12-hour-offsite',
//     frequency: 12,
//     unit: 'hour',
//     offsite: true,
//     retainCount: 60
//   }
// ]

let backupStrategy

const init = async (
  _dryRun = false, 
  storageDir = '../storage'
) => {
  backupStrategy = !!process.env.BACKUP_STRATEGY ? JSON.parse(process.env.BACKUP_STRATEGY) : defaultBackupStrategy
  dryRun = _dryRun
  await storage.init({dir: storageDir})
  firstRun = await storage.getItem('first-run')
  if(!firstRun){
    firstRun = Date.now()
    await storage.setItem('first-run', firstRun)
  }

  setNextTimer()
}

//https://codeburst.io/javascript-async-await-with-foreach-b6ba62bbf404
async function asyncForEach(array, callback) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
}

const setNextTimer = () => {
  let nextRunAt = Number.MAX_VALUE
  let nextStrategy
  backupStrategy.forEach((strategy) => {
    const freqMs = moment(0).add(strategy.frequency, strategy.unit).unix() * 1000
    const currentRunNumber = Math.floor(( Date.now() - firstRun ) / freqMs)
    const nextRun = ((currentRunNumber + 1) * freqMs) + firstRun
    if(nextRun < nextRunAt) {
      nextRunAt = nextRun
      nextStrategy = strategy
    }
  })

  timer = {
    nextRunAt,
    timer: setTimeout(
      backup.bind(null, {
        runAt: nextRunAt
      }),
      nextRunAt - Date.now()
    )
  }
}

const createArchive = async () => new Promise((resolve, reject) =>{
  const outputDir = `${__dirname}/output`
  try{
    if (!fs.existsSync(outputDir)){
      debug('creating-output-folder', outputDir)
      fs.mkdirSync(outputDir)
    }
    if(fs.existsSync(`${outputDir}/output.zip`))
      fs.unlinkSync(`${outputDir}/output.zip`)

      const output = fs.createWriteStream(`${outputDir}/output.zip`);
    const archive = archiver('zip', {
      zlib: { level: 9 } 
    })

    output.on('end', function() {
      console.log('Data has been drained');
    });

    archive.on('warning', function(err) {
      if (err.code === 'ENOENT') {
        // log warning
      } else {
        // throw error
        throw err;
      }
    });

    archive.on('error', function(err) {
      throw err;
    });
  
    output.on('close', function () {
        console.log(archive.pointer() + ' total bytes');
        console.log('archiver has been finalized and the output file descriptor has closed.');
        resolve()
    });
  
    archive.pipe(output);
  
    const globs = process.env.FILE_GLOBS.split(",")
    globs.forEach((glob) => {
      const path = `${__dirname}/backup_source/${glob}`
      if(fs.lstatSync(path).isDirectory()){
        archive.directory(path, glob)
      }else if(fs.lstatSync(path).isFile()){
        archive.file(path, {name: glob})
      }
    })
    
    archive.finalize();
  }catch(error){
    console.error({event:'create-archive-exception', error})
    reject()
    return
  }
})

const getBackupName = (o = {}) => {
  const gameName = o.gameName || process.env.GAME_NAME
  const worldName = o.worldName || process.env.WORLD_NAME
  const strategyName = o.strategyName
  const runNumber = o.runNumber
  return `${gameName}-${worldName}-${strategyName}-${runNumber ?? Date.now()}.zip`
}

const getBucketName = () => `${process.env.GAME_NAME}-${process.env.WORLD_NAME}`

const backup = async ({runAt}) => {
  setNextTimer()

  //find all events that are supposed to fire at runAt
  let matches = []
  backupStrategy.forEach((strategy) => {
    const freqMs = moment(0).add(strategy.frequency, strategy.unit).unix() * 1000
    const currentRunNumber = Math.floor(( Date.now() - firstRun ) / freqMs)
    const nextRun = ((currentRunNumber + 1) * freqMs) + firstRun
    const lastRun = (currentRunNumber * freqMs) + firstRun
    if(nextRun == runAt || lastRun == runAt) {
      matches.push({...strategy, currentRunNumber})
    }
  })

  //create the archive
  if(!dryRun)
    await createArchive()
  
  //move the archive where it needs to go
  if(!dryRun)
    await asyncForEach(matches, async (strategy) => {
      if(strategy.offsite){
        try{
          await s3.createBucket({
            Bucket: getBucketName(), 
            CreateBucketConfiguration: {
              LocationConstraint: "us-east-1"
            }
          }).promise()
          await s3.upload({
            Bucket: getBucketName(),
            Key: getBackupName(),
            Body: fs.createReadStream('./output/output.zip')
          }).promise()
        }catch(error){
          console.error({event:'upload-exception', error})
        }
      }else{
        try{
          fs.copyFileSync(
            './output/output.zip', 
            `./local_backup/${getBackupName({
              strategyName: strategy.name,
              runNumber: strategy.currentRunNumber
            })}`)
        }catch(error){
          console.error({event:'copy-exception', error})
        }
      }
    })

  //destroy the temp archive
  if(!dryRun)
    if (fs.existsSync(`${__dirname}/output/output.zip`)){
      try{
        fs.unlinkSync(`${__dirname}/output/output.zip`, { recursive: true })
      }catch(error){
        console.error({event:'cleanup-exception', error})
      }
    }
  
  //remove all expired backups
  if(!dryRun)
    await asyncForEach(matches, async (strategy) => {
      if(strategy.currentRunNumber > strategy.retainCount){
        const runNumber = strategy.currentRunNumber - strategy.retainCount
        const removeName = getBackupName({
          strategyName: strategy.name,
          runNumber
        })

        if(strategy.offsite){
          try{
            await s3.deleteObject({
              Bucket: getBucketName(),
              Key: removeName
            }).promise()
          }catch(error){
            console.error({event:'cloud-cleanup-exception', error})
          }
        }else{
          try{
            await fs.unlinkSync(`./local_backup/${removeName}`)
          }catch(error){
            console.error({event:'local-cleanup-exception', error})
          }
        }
      }
    })
}

module.exports = { init }