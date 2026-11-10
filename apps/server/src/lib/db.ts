// Prisma istemcisi (Prisma 7 + MySQL sürücü bağdaştırıcısı; dba sapma notu (5)).
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client.ts";

export type Db = PrismaClient;

export const createDb = (databaseUrl: string): Db => new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });
