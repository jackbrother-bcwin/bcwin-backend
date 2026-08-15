import { Role, User as PrismaUser } from "@bcwin/db";

export type JwtPayload = {
    userId: string;
    role: Role;
};

export type User = PrismaUser;
