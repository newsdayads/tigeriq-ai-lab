import {createRelay} from './relay.mjs';
const relay=createRelay(process.env.CAMERA_RELAY_HOME||'D:/TigerIQ/Runtime/CameraRelay');
const [cmd,...arg]=process.argv.slice(2);
if(cmd==='pair'){console.log('PAIR_CODE='+relay.pairCode());process.exit(0);}
if(cmd==='revoke'){console.log('REVOKED='+relay.revoke(arg[0]));process.exit(0);}
if(cmd==='status'){console.log(JSON.stringify(relay.status(),null,2));process.exit(0);}
if(cmd==='publish'){console.log('PUBLISHED='+JSON.stringify(relay.publish(arg[0],Number(arg[1]),arg[2],arg[3])));process.exit(0);}
if(cmd==='serve'){relay.server.listen(Number(process.env.CAMERA_RELAY_PORT||9487),'127.0.0.1',()=>console.log('CAMERA_RELAY_READY'));}
else{console.error('Usage: serve | pair | status | publish APK VERSION_CODE VERSION_NAME SHA256');process.exit(2);}
