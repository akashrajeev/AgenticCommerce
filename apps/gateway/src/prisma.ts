import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import { config } from "./config.js";

let client: PrismaClient | null = null;

export function getPrisma(): PrismaClient | null {
  if (!config.databaseUrl) return null;
  if (client) return client;

  const adapter = new PrismaPg({ connectionString: config.databaseUrl });
  client = new PrismaClient({ adapter });
  return client;
}

export async function closePrisma(): Promise<void> {
  if (!client) return;
  await client.$disconnect();
  client = null;
}
