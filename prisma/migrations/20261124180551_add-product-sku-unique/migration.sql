-- CreateIndex
CREATE UNIQUE INDEX "Product_businessId_sku_key" ON "public"."Product"("businessId", "sku");

