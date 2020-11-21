const storage = require('node-persist');
const moment = require('moment')

//do everything except the backup
let _dryRun = false

//holds our timers for the next runs
let timers = {}

let firstRun

const defaultBackupStrategy = [
  {
    name: 'hourly-local',
    frequency: 1,
    units: 'hour',
    offsite: false,
    retainCount: 24
  },
  {
    name: '12-hour-offsite',
    frequency: 12,
    unit: 'hour',
    offsite: true,
    retainCount: 60
  }
]
const backupStrategy = !!process.env.BACKUP_STRATEGY ? JSON.parse(process.env.BACKUP_STRATEGY) : defaultBackupStrategy

const init = async ({
  dryRun = false, 
  storageDir = '../storage'
}) => {
  dryRun = _dryRun
  await storage.init({dir: storageDir})
  firstRun = await storage.getItem('first-run')
  if(!firstRun){
    firstRun = Date.now()
    await storage.setItem('first-run', firstRun)
  }
  
  //set our times for the next run
  backupStrategy.forEach(({
    name,
    frequency,
    unit
  }) => {
    //figure out what run we're at, and from that calculate the ms epoch of our next run
    const freqMs = moment(0).add(frequency, unit).unix() * 1000
    const currentRunNumber = firstRun - Date.now() / freqMs
    const nextRunAt = (currentRunNumber + 1) * freqMs + firstRun
    
    //check if any other timers have that same execution date
    //if they do, we aren't going to set a 2nd backup event at the same time
    let skip = false
    Object.keys(timers).forEach((key) => {
      const timer = timers[key]
      if(timer.nextRunAt == nextRunAt)
        skip = true
    })
  
    timers[name] = {
      nextRunAt,
      timer: skip ? undefined : setTimeout(
        async () => {
          await backup({
            name, 
            runNumber: currentRunNumber + 1, 
            firstRun
          })
        }, 
        nextRunAt - Date.now())
    }
  });  
}

const backup = async ({
  name,
  runNumber,
  firstRun
}) => {
  console.log({
    event:'do-backup',
    name,
    runNumber,
    firstRun
  })

  //take a backup

  //check if any other backup strategy parts have the same execution time

  //send the backup to all the destinations 

  //set up the next timer
}


module.exports = { init, backup }