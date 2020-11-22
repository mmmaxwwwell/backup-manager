const storage = require('node-persist');
const moment = require('moment')
const { debug } = require('./debug')
const fs = require('fs');
const archiver = require('archiver');
const { match } = require('assert');
var s3 = new AWS.S3();
s3.endpoint = process.env.S3_ENDPOINT

// process.env.DEBUG = "true"

let _dryRun = false
let timer

let firstRun

const defaultBackupStrategy = [
  {
    name: 'test-strategy-part-1',
    frequency: 1,
    unit: 'second',
    offsite: false,
    retainCount: 24
  },
  {
    name: 'test-strategy-part-2',
    frequency: 2,
    unit: 'second',
    offsite: false,
    retainCount: 24
  },
  {
    name: 'test-strategy-part-4',
    frequency: 4,
    unit: 'second',
    offsite: false,
    retainCount: 24
  }
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
  dryRun = false, 
  storageDir = '../storage',
  testBackupStrategy = undefined
) => {
  // backupStrategy = defaultBackupStrategy
  backupStrategy = testBackupStrategy || (!!process.env.BACKUP_STRATEGY ? JSON.parse(process.env.BACKUP_STRATEGY) : defaultBackupStrategy)
  dryRun = _dryRun
  await storage.init({dir: storageDir})
  firstRun = await storage.getItem('first-run')
  if(!firstRun){
    firstRun = Date.now()
    await storage.setItem('first-run', firstRun)
  }

  setNextTimer()
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

const createArchive = () => {
  if (fs.existsSync('./output')){
    fs.rmdirSync('./output', { recursive: true })
  }
  fs.mkdirSync('./output')

  const output = fs.createWriteStream('./output/output.zip');
  const archive = archiver('zip');

  output.on('close', function () {
      console.log(archive.pointer() + ' total bytes');
      console.log('archiver has been finalized and the output file descriptor has closed.');
  });

  archive.on('error', function(err){
      throw err;
  });

  archive.pipe(output);

  const globs = process.env.FILE_GLOBS.split(",")
  
  globs.forEach((glob) => {
    archive.glob(glob)
  })
  
  archive.finalize();
}

const getBackupName = (o = {}) => {
  const gameName = o.gameName || process.env.GAME_NAME
  const worldName = o.worldName || process.env.WORLD_NAME
  const strategyName = o.strategyName
  const runNumber = o.runNumber
  return `${gameName}-${worldName}-${strategyName}-${runNumber ?? Date.now()}.zip`
}

const getBucketName = () => `${process.env.GAME_NAME}-${process.env.WORLD_NAME}`

const backup = async ({runAt}) => {
  debug('do-backup', {
    name,
    runNumber,
    firstRun
  })

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
    createArchive()
  
  //move the archive where it needs to go
  if(!dryRun)
    matches.forEach((strategy) => {
      if(strategy.offsite){
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
      }else{
        await fs.copyFile('./output/output.zip', `./local_backup/${getBackupName()}`)
      }
    })

  //destroy the temp archive
  if(!dryRun)
    if (fs.existsSync('./output')){
      fs.rmdirSync('./output', { recursive: true })
    }
  
  //remove all expired backups
  if(!dryRun)
    matches.forEach((strategy) => {
      if(strategy.currentRunNumber > strategy.retainCount){
        const runNumber = strategy.currentRunNumber - strategy.retainCount
        const removeName = getBackupName({
          strategyName: strategy.name,
          runNumber
        })

        if(match.offsite){
          await s3.deleteObject({
            Bucket: getBucketName(),
            Key: removeName
          }).promise()
        }else{
          await fs.unlink(`./local_backup/${removeName}`)
        }
      }
    })
}

module.exports = { init, backup, timers }