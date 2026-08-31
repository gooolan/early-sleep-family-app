package app

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"
)

func TestNormalizePriceUnits(t *testing.T) {
	unitPrice := 32.0
	price, unit, err := normalizePrice(PriceEntryUnit, &unitPrice, nil, nil, "kilogram")
	if err != nil {
		t.Fatal(err)
	}
	if price != 16 || unit != "jin" {
		t.Fatalf("kilogram price = %g/%s, want 16/jin", price, unit)
	}
	purchaseQuantity := 1.25
	price, unit, err = normalizePrice(PriceEntryUnit, &unitPrice, nil, &purchaseQuantity, "kilogram")
	if err != nil {
		t.Fatal(err)
	}
	if price != 16 || unit != "jin" {
		t.Fatalf("kilogram price with purchase quantity = %g/%s, want 16/jin", price, unit)
	}

	totalPrice := 39.8
	quantity := 1.2
	price, unit, err = normalizePrice(PriceEntryTotal, nil, &totalPrice, &quantity, "kilogram")
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(price-16.5833333333) > 0.000001 || unit != "jin" {
		t.Fatalf("total price = %g/%s, want about 16.58/jin", price, unit)
	}

	price, unit, err = normalizePrice(PriceEntryTotal, nil, &totalPrice, &quantity, "box")
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(price-33.1666666667) > 0.000001 || unit != "box" {
		t.Fatalf("box price = %g/%s, want about 33.17/box", price, unit)
	}
}

func TestPriceCatalogCRUDAndUndo(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(store)
	current := time.Date(2026, 8, 31, 10, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return current }
	session, err := service.CreateFamily(context.Background(), CreateFamilyRequest{
		FamilyName: "菜价家庭",
		Nickname:   "甲",
		Phone:      "13800138881",
		Timezone:   "Asia/Shanghai",
	})
	if err != nil {
		t.Fatal(err)
	}
	emptyCatalog, err := service.GetPriceCatalog(context.Background(), session.Token)
	if err != nil {
		t.Fatal(err)
	}
	if emptyCatalog.Products == nil || emptyCatalog.Stores == nil || emptyCatalog.Records == nil {
		t.Fatal("empty price catalog fields must be encoded as arrays")
	}

	catalog, err := service.CreateProduct(context.Background(), session.Token, CreateProductRequest{Name: " 猪里脊 ", IconKey: "meat"})
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.Products) != 1 || catalog.Products[0].Name != "猪里脊" {
		t.Fatalf("products = %+v", catalog.Products)
	}
	catalog, err = service.CreateProduct(context.Background(), session.Token, CreateProductRequest{Name: "猪里脊"})
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.Products) != 1 {
		t.Fatalf("duplicate product count = %d, want 1", len(catalog.Products))
	}
	catalog, err = service.CreatePriceStore(context.Background(), session.Token, CreatePriceStoreRequest{Name: "永辉超市·金科店", BrandKey: "yonghui"})
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.Stores) != 1 {
		t.Fatalf("store count = %d, want 1", len(catalog.Stores))
	}

	unitPrice := 32.0
	purchaseQuantity := 1.25
	catalog, err = service.CreatePriceRecord(context.Background(), session.Token, SavePriceRecordRequest{
		ProductID:   catalog.Products[0].ID,
		StoreID:     catalog.Stores[0].ID,
		PurchasedAt: "2026-08-31T09:30:00+08:00",
		EntryMode:   PriceEntryUnit,
		UnitPrice:   &unitPrice,
		Quantity:    &purchaseQuantity,
		Unit:        "kilogram",
		PriceKind:   PriceKindDiscount,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.Records) != 1 || catalog.Records[0].NormalizedPrice != 16 || catalog.Records[0].NormalizedUnit != "jin" || catalog.Records[0].Quantity == nil || *catalog.Records[0].Quantity != purchaseQuantity {
		t.Fatalf("records = %+v", catalog.Records)
	}
	recordID := catalog.Records[0].ID

	quality := 5
	catalog, err = service.UpdatePriceQuality(context.Background(), session.Token, recordID, UpdatePriceQualityRequest{Quality: &quality})
	if err != nil {
		t.Fatal(err)
	}
	if catalog.Records[0].Quality == nil || *catalog.Records[0].Quality != 5 {
		t.Fatalf("quality = %v, want 5", catalog.Records[0].Quality)
	}

	catalog, err = service.DeletePriceRecord(context.Background(), session.Token, recordID)
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.Records) != 0 {
		t.Fatalf("records after delete = %d, want 0", len(catalog.Records))
	}
	catalog, err = service.RestorePriceRecord(context.Background(), session.Token, recordID)
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.Records) != 1 {
		t.Fatalf("records after restore = %d, want 1", len(catalog.Records))
	}

	backup, err := service.ExportFamily(context.Background(), session.Token)
	if err != nil {
		t.Fatal(err)
	}
	if len(backup.Family.Products) != 1 || len(backup.Family.PriceStores) != 1 || len(backup.Family.PriceRecords) != 1 {
		t.Fatalf("price catalog missing from backup: %+v", backup.Family)
	}
}

func TestPriceRecordValidation(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(store)
	session, err := service.CreateFamily(context.Background(), CreateFamilyRequest{FamilyName: "校验", Nickname: "甲", Phone: "13800138882", Timezone: "Asia/Shanghai"})
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := service.CreateProduct(context.Background(), session.Token, CreateProductRequest{Name: "牛奶"})
	if err != nil {
		t.Fatal(err)
	}
	catalog, err = service.CreatePriceStore(context.Background(), session.Token, CreatePriceStoreRequest{Name: "盒马"})
	if err != nil {
		t.Fatal(err)
	}
	zero := 0.0
	_, err = service.CreatePriceRecord(context.Background(), session.Token, SavePriceRecordRequest{
		ProductID: catalog.Products[0].ID,
		StoreID:   catalog.Stores[0].ID,
		EntryMode: PriceEntryUnit,
		UnitPrice: &zero,
		Unit:      "liter",
		PriceKind: PriceKindRegular,
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("zero price error = %v, want ErrInvalidInput", err)
	}
	negativeQuantity := -1.0
	validUnitPrice := 12.0
	_, err = service.CreatePriceRecord(context.Background(), session.Token, SavePriceRecordRequest{
		ProductID: catalog.Products[0].ID,
		StoreID:   catalog.Stores[0].ID,
		EntryMode: PriceEntryUnit,
		UnitPrice: &validUnitPrice,
		Quantity:  &negativeQuantity,
		Unit:      "liter",
		PriceKind: PriceKindRegular,
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("negative purchase quantity error = %v, want ErrInvalidInput", err)
	}
}
