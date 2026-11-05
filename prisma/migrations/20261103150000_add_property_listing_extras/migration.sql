-- CreateEnum
CREATE TYPE "ListingOperation" AS ENUM ('SALE', 'RENT');


-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "age_years" INTEGER,
ADD COLUMN     "bathrooms" INTEGER,
ADD COLUMN     "bedrooms" INTEGER,
ADD COLUMN     "covered_area_m2" DECIMAL(10,2),
ADD COLUMN     "latitude" DECIMAL(9,6),
ADD COLUMN     "listing_operation" "ListingOperation" NOT NULL DEFAULT 'RENT',
ADD COLUMN     "longitude" DECIMAL(9,6),
ADD COLUMN     "rooms" INTEGER,
ADD COLUMN     "total_area_m2" DECIMAL(10,2);

