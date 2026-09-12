$env:PORT = if ($env:PORT) { $env:PORT } else { 3000 }
$env:NODE_ENV = 'production'
node apps/tigeriq-core/web-control-server.mjs
