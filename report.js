/*! Copyright (C) Grexx - All Rights Reserved
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and Confidential
 */

"use strict";
const _           = require('lodash'),
      os          = require('os'),
      fs          = require('fs'),
      https       = require('https'),
      storage     = require('storage-device-info'),
      driveList   = require('drivelist'),
      packageInfo = require('./package.json');

class Report {

    constructor( configuration = {} ) {
        this.hostname = configuration.hostname;
        this.port     = configuration.port;
        this.path     = configuration.path;
        this.headers  = configuration.headers;
        this.version  = packageInfo.version;
        this.debug    = configuration.debug === true;
    }

    createReport() {
        Promise.all([this.diskSpace(), this.serverStatus()])
            .then(result => {
                let finalResult       = result[1];
                finalResult.diskCount = result[0].count;
                finalResult.disks     = result[0].disks;
                finalResult.version   = this.version;
                this.send(finalResult);
            })
            .catch(error => {
                console.error('ERROR', error);
            });
    }

    diskSpace() {
        return new Promise(( resolve, reject ) => {
            driveList.list(( error, drives ) => {
                if ( error ) {
                    reject(error);
                }

                Promise.all(drives.map(d => this.getOneMountPoint(d)))
                    .then(diskArray => {
                        let diskObject   = {};
                        diskObject.count = diskArray.length;
                        diskObject.disks = {};
                        //diskArray.forEach(disk => {
                        //    const diskName             = 'disk.' + disk.mountpoints.map(mp =>
                        // mp.path).join('.').replace(/:/gmi, ''); diskObject.disks[diskName] = disk; });
                        // resolve(diskObject);
                        diskObject.disks = diskArray;
                        resolve(diskObject);
                    })
                    .catch(reject);
            });
        });

    }

    getOneMountPoint( driveInfo ) {
        return new Promise(( resolve, reject ) => {
            let mountPoint = _.result(driveInfo, 'mountpoints[0].path') || driveInfo.device;
            storage.getPartitionSpace(mountPoint, ( error, space ) => {
                if ( error ) {
                    console.error('Cannot get diskSpace for', driveInfo.device, error.message);
                    reject(error);
                } else {
                    space.inUse = 100 - (space.freeMegaBytes / space.totalMegaBytes * 100);
                    _.merge(driveInfo, space);
                    driveInfo.mountpoints = driveInfo.mountpoints.map(mp => mp.path).join(',');
                    resolve(driveInfo);
                }
            });
        });
    }

    serverStatus() {
        return new Promise(( resolve, reject ) => {
            const network       = os.networkInterfaces(),
                  load          = os.loadavg(),
                  cpu           = os.cpus();
            let serverData      = {};
            serverData.cpu      = _.uniq(cpu.map(c => c.model)).join(', ');
            serverData.cores    = cpu.length;
            serverData.load1    = load[0];
            serverData.load5    = load[1];
            serverData.load15   = load[2];
            serverData.network  = _.mapValues(network, ( v, key ) => _.map(v, n => `${n.address} (${n.family})`).join(', '));
            serverData.ips      = _.map(network, ( v, key ) => _.map(v, n => `${n.address} (${n.family})`).join(', '));
            serverData.platform = os.platform();
            serverData.arch     = os.arch();
            serverData.release  = os.release();
            serverData.osType   = os.type();
            serverData.hostname = os.hostname();
            serverData.memFree  = os.freemem();
            serverData.memTotal = os.totalmem();
            serverData.memInUse = 100 - (serverData.memFree / serverData.memTotal * 100);
            serverData.uptime   = os.uptime();

            if ( serverData.platform === 'win32' ) {
                const winCpu = require('windows-cpu');
                winCpu.totalLoad(( error, cpuInfo ) => {
                    if ( !error ) {
                        serverData.load1 = cpuInfo.length === 1 ? cpuInfo[0] : _.mean(cpuInfo);
                        delete serverData.load5;
                        delete serverData.load15;
                    }
                    resolve(serverData);
                });

            } else {
                resolve(serverData);
            }
        });
    }

    send( info ) {
        return new Promise(( resolve, reject ) => {
            const postData = JSON.stringify(info),
                  options  = {
                      hostname: this.hostname,
                      port:     this.port,
                      path:     this.path,
                      method:   'POST',
                      headers:  _.merge({
                          'Content-Type':   'application/json',
                          'Content-Length': Buffer.byteLength(postData)
                      }, this.headers)
                  };

            if ( this.debug === true ) {
                console.info('post-to', JSON.stringify(options, null, '\t'));
                console.info('post-data', JSON.stringify(info, null, '\t'));
                return resolve();
            }

            let req = https.request(options, ( res ) => {
                console.log(`SEND::STATUS: ${res.statusCode}`);
                res.setEncoding('utf8');
                res.on('data', ( chunk ) => {
                    console.info(`SEND::BODY: ${chunk}`);
                });
                res.on('end', () => {
                    console.info('SEND::DONE');
                });
            });

            req.on('error', ( e ) => {
                console.error(`problem with request: ${e.message}`);
            });

            req.write(postData);
            req.end();
        });
    }
}

module.exports = Report;

if ( process.argv[2] === '--run' ) {
    let report = new Report();
    report.createReport();
}