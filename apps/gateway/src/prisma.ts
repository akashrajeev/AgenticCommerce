import { PrismaPg } from "@prisma/adapter-pg";
import type { PrismaClient as GeneratedPrismaClient } from "./generated/prisma/client.js";
import { config } from "./config.js";

type PrismaClientInstance = GeneratedPrismaClient;
type PrismaClientModule = typeof import("./generated/prisma/client.js");

let client: PrismaClientInstance | null = null;
let clientPromise: Promise<PrismaClientInstance | null> | null = null;

export async function getPrisma(): Promise<PrismaClientInstance | null> {
  if (!config.databaseUrl) return null;
  if (client) return client;
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    const importPath = process.env.NODE_ENV === "production"
      ? "./generated/prisma/client.js"
      : "./generated/prisma/client.ts";
    const { PrismaClient } = (await import(importPath)) as PrismaClientModule;
    const adapter = new PrismaPg({ connectionString: config.databaseUrl! });
    client = new PrismaClient({ adapter });
    return client;
  })();

  try {
    return await clientPromise;
  } finally {
    clientPromise = null;
  }
}

export async function closePrisma(): Promise<void> {
  if (!client) return;
  await client.$disconnect();
  client = null;
}
