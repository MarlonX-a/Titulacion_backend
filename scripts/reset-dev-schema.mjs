// Drops the local titulacion_dev schema so migrations can recreate it. Never touches public or local_demo.
import { connectDevDatabase, DEV_SCHEMA } from './dev-database.mjs';

const client = await connectDevDatabase('reset');
try {
  await client.query(`DROP SCHEMA IF EXISTS "${DEV_SCHEMA}" CASCADE`);
  console.log(`Schema ${DEV_SCHEMA} dropped. Run npm run db:prepare-auth, npm run usuario:bootstrap-admin (optional) and npm run db:seed-dev-users.`);
} finally {
  await client.end();
}
