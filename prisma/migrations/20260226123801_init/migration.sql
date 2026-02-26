-- CreateEnum
CREATE TYPE "RideStatus" AS ENUM ('BOOKED', 'ACTIVE', 'RISK_FLAGGED', 'SOS_ACTIVE', 'RESOLVED');

-- CreateTable
CREATE TABLE "Ride" (
    "id" TEXT NOT NULL,
    "passengerId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "cabDeviceId" TEXT NOT NULL,
    "status" "RideStatus" NOT NULL DEFAULT 'BOOKED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SOS" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SOS_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "SOS" ADD CONSTRAINT "SOS_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;
