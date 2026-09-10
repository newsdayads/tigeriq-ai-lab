import type { SqlPoolLike } from './postgres-repository.js';
/** Core build stays dependency-free; PC01 may install free `pg@8` locally and load it dynamically. */
export async function createPgPool(connectionString:string,max=10):Promise<SqlPoolLike>{if(!connectionString.trim())throw new Error('PostgreSQL connection string is required');const moduleName='pg';const loaded=await import(moduleName) as unknown as {Pool:new(options:Record<string,unknown>)=>SqlPoolLike};return new loaded.Pool({connectionString,max,application_name:'tigeriq-work-state-v1'});}
