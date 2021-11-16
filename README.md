# crust-nft-storage
Save all nftscan's data on Crust

## Start up

### Start watcher 

Please allow your ***30888*** port by running(on ubuntu):
```
sudo ufw allow 30888
```

At project root directory run:
```
sudo docker-compose -f docker/watch-chain.yaml up -d
```
to start a watcher for order and wait for chain synchronization complete. You can use '***sudo docker logs crust-watch -f***' to see syncing progress

### Bootstrap configure 
a ***.env*** file needs to be created in the project root directory, a sample ***.env*** file shows as follow:
```
CRUST_SEEDS="xxxxxxxx"
CHAIN_ADDR="ws://localhost:19933"
SERVER_PORT=8765
```

1. CRUST_SEEDS: Crust network account seeds
1. CHAIN_ADDR: Crust network address, you can use the watcher started in previous step which is '***ws://localhost:19933***'
1. SERVER_PORT: server listen port

### Start service
```
yarn && yarn start
```

## APIs

### '/process' API

```
curl -XPOST http://localhost:<port>/api/v0/process?tx=xxx&orderNumLimit=xxx&orderSizeLimit=xxx
```

#### Description
Order nfts

#### Parameter
1. tx: required, transaction hash
1. orderNumLimit: optional, max total file number limit per order, default is 100
1. orderSizeLimit: optional, max total file size limit per order, default is 5GB

#### Output
```
{
    "statusCode": 200,
    "message": "task(tx:xxx) added successfully"
}
```

### '/progress' API

```
curl -XGET http://localhost:<port>/api/v0/progress
```

#### Description
Check running task information

#### Output:
```
{
    "tx": "xxxx",
    "total": 1000,
    "complete": 500,
    "remaining": 500,
    "completeOrder": [
        "xxx1",
        "xxx2",
        "xxx3",
        "xxx4"
    ]
}
```

### '/replica' API

```
curl -XGET http://localhost:<port>/api/v0/replica?cid=xxx
```

#### Description
Get indicated order's replica through Crust network

#### Parameter
1. cid: required, IPFS content id

#### Output
```
{
    "cid": "xxx",
    "replica": 100
}
```
