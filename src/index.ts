import NFTScan from './nftscan';
import { port } from './consts'
import { checkReplica } from './utils/utils'

const http = require('http');

async function main() {
  const ni = new NFTScan()
  await ni.init();

  // Create a local server to receive data from
  const server = http.createServer();

  // Listen to the request event
  server.on('request', async (req: any, res: any) => {
    let url = new URL(req.url, `http://${req.headers.host}`)
    let resCode = 200
    let resBody = {}
    let resMsg = ''
    if ('/process' === url.pathname) {
      const tx = url.searchParams.get('tx')
      const orderNumLimit = url.searchParams.get('orderNumLimit')
      const orderSizeLimit = url.searchParams.get('orderSizeLimit')
      if (tx !== null) {
        const runningTask = ni.getRunningTask()
        if (runningTask !== '') {
          resMsg = `another process(tx:${runningTask}) is running`
          resCode = 400
        } else {
          if (orderNumLimit !== null) { 
            ni.setOrderNumLimit(parseInt(orderNumLimit)) 
          }
          if (orderSizeLimit !== null) { 
            ni.setOrderSizeLimit(parseInt(orderSizeLimit))
          }
          ni.requestProcess(tx)
          resMsg = `task(tx:${tx}) added successfully`
        }
      } else {
        resMsg = 'illegal parameter, need parameter:tx'
        resCode = 500
      }
    } else if ('/progress' === url.pathname) {
      const info = ni.getProcessInfo()
      if (info['tx'] === '') {
        resMsg = 'no task is running'
      } else {
        resBody = info
      }
    } else if ('/replica' === url.pathname) {
      const cid = url.searchParams.get('cid')
      if (cid !== null) {
        try {
          const replica = await checkReplica(cid)
          resBody = {
            cid: cid,
            replica: replica
          }
        } catch(e: any) {
          resMsg = `Get file:'${cid}' replica failed`
          resCode = 500
        }
      } else {
        resMsg = 'illegal parameter, need parameter:cid'
        resCode = 500
      }
    } else {
      resMsg = `unknown request:${url.pathname}`
      resCode = 404
    }
    if (resMsg !== '') {
      resBody = {
        statusCode: resCode,
        message: resMsg
      }
    }
    res.writeHead(resCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(resBody));
  });

  server.listen(port);
  console.log(`Start server on port:${port} successfully`)
}

main()
