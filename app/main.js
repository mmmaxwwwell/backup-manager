const storage = require('node-persist');
const moment = require('moment')

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

let timers = {}

const backupStrategy = !!process.env.BACKUP_STRATEGY ? JSON.parse(process.env.BACKUP_STRATEGY) : defaultBackupStrategy

const doBackup = async ({
  name,
  runNumber
}) => {
  console.log({
    event:'do-backup',
    name,
    runNumber
  })
  //take a backup

  //check if any other backup strategy parts have the same execution time

  //send the backup to all the destinations 

  //set up the next timer
}

(async () => {
  try {
    //get or set our initial run time
    await storage.init({dir: '../storage'})
    let firstRun = await storage.getItem('first-run')
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
      timers.forEach((timer) => {
        if(timer.nextRunAt == nextRunAt)
          skip = true
      })

      timers[name] = {
        nextRunAt,
        timer: skip ? undefined : setTimeout(() => {
          doBackup({name, runNumber: currentRunNumber + 1})
        }, nextRunAt - Date.now())
      }
    });

  } catch (error) {
    console.log({event: 'unhandled-exception', error})
  }
})()
