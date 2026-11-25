-- AlterTable
ALTER TABLE "public"."Invoice" ADD COLUMN     "earlyDiscountDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "earlyDiscountType" "public"."DiscountType" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "earlyDiscountValue" DECIMAL(19,4) NOT NULL DEFAULT 0,
ADD COLUMN     "invoiceDiscountTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
ADD COLUMN     "invoiceDiscountType" "public"."DiscountType" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "invoiceDiscountValue" DECIMAL(19,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "public"."Payment" ADD COLUMN     "earlyDiscountAmount" DECIMAL(19,4) NOT NULL DEFAULT 0;
