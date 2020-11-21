const backup = require('./backup');

(async () => {
  try {
    backup.init()
  } catch (error) {
    console.log({event: 'unhandled-exception', error})
  }
})()
