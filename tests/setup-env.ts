import { config } from "dotenv";
config({ path: ".env" });
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DATABASE_OWNER_URL = process.env.TEST_DATABASE_OWNER_URL;
process.env.EMAIL_DRIVER = "silent";
process.env.WIX_INTAKE_SECRET = "test-secret";
process.env.INNGEST_EVENT_KEY = "";
