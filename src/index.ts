import NFTScan from './nftscan';
import { orderSizeDefault, orderNumDefault } from './nftscan';
import {
  SERVER_PORT,
  CHAIN_ADDR,
  NFT_LIST_URL,
  NFT_UPDATETOKENURI_URL,
  NFT_UPDATESTATUS_URL,
  IPFS_HOMEDIR } from './consts'
import { checkReplica, isNumeric } from './utils/utils'

const http = require('http');

async function main() {
  const config = {
    chainAddress: CHAIN_ADDR,
    nftListUrl: NFT_LIST_URL,
    nftUpdateTokenUriUrl: NFT_UPDATETOKENURI_URL,
    nftUpdateStatusUrl: NFT_UPDATESTATUS_URL,
    ipfsHomeDir: IPFS_HOMEDIR,
    port: SERVER_PORT
  }
  console.log('Config:')
  console.log(config)

  const ni = new NFTScan()
  const initRes = await ni.init()
  if (!initRes)
    return

  // Create a local server to receive data from
  const server = http.createServer();

  // Listen to the request event
  server.on('request', async (req: any, res: any) => {
    let url = new URL(req.url, `http://${req.headers.host}`)
    let resCode = 200
    let resBody = {}
    let resMsg = ''
    const restfulHead = '/api/v0'
    const reqHead = url.pathname.substr(0, restfulHead.length)
    if (reqHead !== restfulHead) {
      resBody = {
        statusCode: 404,
        message: `unknown request:${url.pathname}`
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(resBody));
      return
    }
    const route = url.pathname.substr(restfulHead.length)
    if (req.method === 'POST') {
      if ('/process' === route) {
        const address = url.searchParams.get('address')
        const orderNumLimit = url.searchParams.get('orderNumLimit')
        const orderSizeLimit = url.searchParams.get('orderSizeLimit')
        const sync = url.searchParams.get('sync')
        if (address !== null) {
          const runningTask = ni.getRunningTask()
          if (runningTask !== '') {
            resMsg = `another process(address:${runningTask}) is running`
            resCode = 400
          } else {
            let paramInfo = ''
            if (orderNumLimit !== null) {
              if (isNumeric(orderNumLimit)) {
                paramInfo += ni.setOrderNumLimit(parseInt(orderNumLimit))
              } else {
                paramInfo += ` Invalid parameter orderNumLimit:${orderNumLimit}, use default:${orderNumDefault}.`
              }
            }
            if (orderSizeLimit !== null) {
              if (isNumeric(orderSizeLimit)) { 
                paramInfo += ni.setOrderSizeLimit(parseInt(orderSizeLimit))
              } else {
                paramInfo += ` Invalid parameter orderSizeLimit:${orderSizeLimit}, use default:${orderSizeDefault}.`
              }
            }
            if (sync === 'true') {
              await ni.doProcess(address)
              resMsg = `task(address:${address}) has been done!` + paramInfo
            } else {
              ni.doProcess(address)
              resMsg = `task(address:${address}) added successfully!` + paramInfo
            }
          }
        } else {
          resMsg = 'illegal parameter, need parameter:address'
          resCode = 500
        }
      } else {
        resMsg = `unknown request:${url.pathname}`
        resCode = 404
      }
    } else {
      if ('/progress' === route) {
        const info = ni.getProcessInfo()
        if (info['address'] === '') {
          resMsg = 'no task is running'
        } else {
          resBody = info
        }
      } else if ('/replica' === route) {
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
      } else if ('/stop' === route) {
        const result = ni.stopTask()
        if (result) {
          resMsg = 'Task will be exited'
        } else {
          resMsg = 'No task is running'
        }
        resCode = 200
      } else {
        resMsg = `unknown request:${url.pathname}`
        resCode = 404
      }
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

  server.listen(SERVER_PORT);
  console.log(`Start server on port:${SERVER_PORT} successfully`)
}

main()
