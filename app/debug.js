const debug = (event, obj) => {
  if(process.env.DEBUG)
    console.log({event, obj})
}
module.exports = { debug }