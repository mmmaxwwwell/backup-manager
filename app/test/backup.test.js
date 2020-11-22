
const fs = require('fs');
const tmpDir = `${__dirname}/tmp`
const debug = require('debug')

beforeEach(() => {
  jest.useFakeTimers()
});

afterEach(() => {
  jest.useRealTimers()
});

beforeAll(() => {
  process.env.DEBUG = "true"
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
  const backup = require('../backup-manager');
  await backup.init(true, storageDir)
  const storage = require('node-persist')
  await storage.init({dir: storageDir})
  let firstRun = await storage.getItem('first-run')
  const backup2 = require('../backup-manager');
  await backup2.init(true, storageDir)
  let firstRun2 = await storage.getItem('first-run')
  expect(firstRun).toBe(firstRun2)
  expect(typeof(firstRun)).toBe('number')
});

