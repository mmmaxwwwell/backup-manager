const backupManager = require('./backup-manager');

(async () => {
  try {
    await backupManager.init()
  } catch (error) {
    console.log({event: 'unhandled-exception', error})
  }
})()