# nftscan-saver
Save all nftscan's data on Crust

## Start up

### Start watcher 

Please allow your 30888 port by running(on ubuntu):
```
sudo ufw allow 30888
```

At project root directory run:
```
sudo docker-compose -f docker/watch-chain.yaml up -d
```
to start a watcher for order and wait for chain synchronization complete. You can use ***sudo docker logs crust-watch -f*** to see syncing progress

### Bootstrap configure 
A **.env** file needs to be created in the project root directory, a sample **.env** file shows as follow:
```
CRUST_SEEDS="xxxxxxxx"
CHAIN_ADDR="ws://localhost:19933"
SERVER_PORT=8765
```

1. CRUST_SEEDS: Crust network account seeds
1. CHAIN_ADDR: Crust network address, you can use the watcher started in previous step which is **ws://localhost:19933**
1. SERVER_PORT: server listen port

### Start service
```
yarn && yarn start
```
