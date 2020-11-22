const storage = require('node-persist');
const moment = require('moment')
const { debug } = require('./debug')
const fs = require('fs');
const archiver = require('archiver')
const AWS = require('aws-sdk')
const child_process = require('child_process')
const crypto = require('crypto')
const s3 = new AWS.S3({
  region: process.env.S3_REGION,
  endpoint: `${process.env.S3_REGION}.${process.env.S3_ENDPOINT}`,
  apiVersion: "2006-03-01",
  credentials: new AWS.Credentials({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }),
  sslEnabled: true,
  s3ForcePathStyle: false
})
s3.api.globalEndpoint = s3.config.endpoint;
// process.env.DEBUG = "true"
let dryRun = false
let timer
let firstRun

const defaultBackupStrategy = [
  {
    name: '15mlocal',
    frequency: 900000,
    offsite: false,
    retainCount: 96
  },
  {
    name: '12hcloud',
    frequency: 3600000 * 12,
    offsite: true,
    retainCount: 60
  }
]

// const defaultBackupStrategy = [
//   {
//     name: '15slocal',
//     frequency: 1000 * 15,
//     offsite: false,
//     retainCount: 2
//   },
//   {
//     name: '30scloud',
//     frequency: 1000 * 15,
//     offsite: true,
//     retainCount: 2
//   }
// ]


let backupStrategy

const init = async (
  _dryRun = false, 
  storageDir = `${__dirname}/storage`
) => {
  console.log('backup-manager init')
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
    const currentRunNumber = Math.floor(( Date.now() - firstRun ) / strategy.frequency)
    const nextRun = ((currentRunNumber + 1) * strategy.frequency) + firstRun
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
  console.log(`next run scheduled at ${moment(nextRunAt).toISOString()} for ${nextStrategy.name}`)
}

function checksumFile(hashName, path) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(hashName);
    const stream = fs.createReadStream(path);
    stream.on('error', err => reject(err));
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
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
  
    output.on('close', async () => {
        resolve(await checksumFile('sha256', `${outputDir}/output.zip`))
    });
  
    archive.pipe(output);
    const includeRegexes = process.env.FILES_INCLUDE.split(',')
    const excludeRegexes = process.env.FILES_EXCLUDE.split(',')
    //theres probably a more efficent way to do this, 
    //i'll fix it when theres a problem
    const findResult = child_process.execSync('find', {
      cwd: `${__dirname}/backup_source`
    }).toString().split('\n').filter((value, index, arr) => {
      return value != '' && value != '.'
    }).filter((value, index, arr) => {
      let include = true
      excludeRegexes.find(regex => {
        if(value.match(regex))
          include = false
      })
      if(!include)
        return include
      include = false
      includeRegexes.find(regex => {
        if(value.match(regex))
          include = true
      });
      return include
    })

    findResult.forEach(filePath => {
      const subPath = filePath.replace('./', '')
      const absPath = `${__dirname}/backup_source/${subPath}`
      archive.file(absPath, {
        name: subPath
      })
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
  return `${gameName}-${worldName}-${strategyName}-${runNumber || Date.now()}.zip`
}

const getBucketName = () => {
  return `${process.env.GAME_NAME}-${process.env.WORLD_NAME}`
}

const backup = async ({runAt}) => {
  setNextTimer()

  //find all events that are supposed to fire at runAt
  let matches = []
  backupStrategy.forEach((strategy) => {
    const currentRunNumber = Math.floor(( Date.now() - firstRun ) / strategy.frequency)
    const nextRun = ((currentRunNumber + 1) * strategy.frequency) + firstRun
    const lastRun = (currentRunNumber * strategy.frequency) + firstRun
    if(nextRun == runAt || lastRun == runAt) {
      matches.push({...strategy, currentRunNumber})
    }
  })

  //create the archive
  let checksum
  if(!dryRun)
    checksum = await createArchive()
  
  //move the archive where it needs to go
  if(!dryRun)
    await asyncForEach(matches, async (strategy) => {
      if(strategy.offsite){
        try{
          await s3.createBucket({
            Bucket: getBucketName(), 
          }).promise()
          await s3.upload({
            Bucket: getBucketName(),
            Key: getBackupName({
              strategyName: strategy.name,
              runNumber: strategy.currentRunNumber
            }),
            Body: fs.createReadStream('./output/output.zip')
          }).promise()
          console.log(`uploaded ${getBackupName({
            strategyName: strategy.name,
            runNumber: strategy.currentRunNumber
          })} to ${getBucketName()} for ${strategy.name} at ${moment().toISOString()} with checksum ${checksum}`)
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
            console.log(`uploaded ${getBackupName({
              strategyName: strategy.name,
              runNumber: strategy.currentRunNumber
            })} to ./local_backup/ for ${strategy.name} at ${moment().toISOString()} with checksum ${checksum}`)
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
            console.log(`removed ${removeName} from ${getBucketName()} for ${strategy.name} at ${moment().toISOString()}`)
          }catch(error){
            console.error({event:'cloud-cleanup-exception', error})
          }
        }else{
          try{
            await fs.unlinkSync(`./local_backup/${removeName}`)
            console.log(`removed ${removeName} from ./local_backup/ for ${strategy.name} at ${moment().toISOString()}`)
          }catch(error){
            console.error({event:'local-cleanup-exception', error})
          }
        }
      }
    })
}

module.exports = { init }