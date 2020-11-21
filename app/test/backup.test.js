
const fs = require('fs');
const tmpDir = './tmp'

const checkNodeVersion = () => {
  let major = parseInt(process.version.match(/^v(\d*)/)[1])
  if(major < 14)
    throw "requires node version 14 or greater"
}

beforeEach(() => {
});

afterEach(() => {
});

beforeAll(() => {
  checkNodeVersion()
  if (!fs.existsSync(tmpDir)){
    fs.mkdirSync(tmpDir)
  }
})

afterAll(() => {
  fs.rmdirSync(`${tmpDir}`, { recursive: true })
});

test('sets firstRun and is the same value on subsequent runs', async () => {
  const storageDir = tmpDir + `/${Date.now()}firstRun`
  fs.mkdirSync(storageDir)
  const backup = require('../backup');
  await backup.init({dryRun: true, storageDir})
  const storage = require('node-persist')
  await storage.init({dir: storageDir})
  let firstRun = await storage.getItem('first-run')
  const backup2 = require('../backup');
  await backup2.init({dryRun: true, storageDir})
  let firstRun2 = await storage.getItem('first-run')
  expect(firstRun).toBe(firstRun2)
  expect(typeof(firstRun)).toBe('number')
});

test('creates and executes one timer', async () => {
  jest.useFakeTimers()
  const storageDir = `${tmpDir}/${Date.now()}createAndExecute`
  process.env.BACKUP_STRATEGY = [
    {
      name: 'test-strategy-part',
      frequency: 1,
      units: 'second',
      offsite: false,
      retainCount: 24
    }
  ].toString()
  const backup = require('../backup');
  const backupSpy = jest.spyOn(backup, "backup")
  await backup.init({dryRun: true, storageDir})
  setTimeout(() => {
    expect(backupSpy).toBeCalled()
  }, 5000)
})


