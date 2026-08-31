package app

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	PriceEntryUnit  = "unit_price"
	PriceEntryTotal = "total_price"

	PriceKindRegular  = "regular"
	PriceKindDiscount = "discount"
)

type Product struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	IconKey   string    `json:"iconKey,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

type PriceStore struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	BrandKey  string    `json:"brandKey,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

type PriceRecord struct {
	ID              string     `json:"id"`
	ProductID       string     `json:"productId"`
	StoreID         string     `json:"storeId"`
	MemberID        string     `json:"memberId"`
	PurchasedAt     time.Time  `json:"purchasedAt"`
	EntryMode       string     `json:"entryMode"`
	UnitPrice       *float64   `json:"unitPrice,omitempty"`
	TotalPrice      *float64   `json:"totalPrice,omitempty"`
	Quantity        *float64   `json:"quantity,omitempty"`
	Unit            string     `json:"unit"`
	NormalizedPrice float64    `json:"normalizedPrice"`
	NormalizedUnit  string     `json:"normalizedUnit"`
	PriceKind       string     `json:"priceKind"`
	ReferencePrice  *float64   `json:"referencePrice,omitempty"`
	ReferenceUnit   string     `json:"referenceUnit,omitempty"`
	Quality         *int       `json:"quality,omitempty"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
	DeletedAt       *time.Time `json:"deletedAt,omitempty"`
}

type PriceCatalogView struct {
	Products []Product     `json:"products"`
	Stores   []PriceStore  `json:"stores"`
	Records  []PriceRecord `json:"records"`
}

type CreateProductRequest struct {
	Name    string `json:"name"`
	IconKey string `json:"iconKey,omitempty"`
}

type CreatePriceStoreRequest struct {
	Name     string `json:"name"`
	BrandKey string `json:"brandKey,omitempty"`
}

type SavePriceRecordRequest struct {
	ProductID      string   `json:"productId"`
	StoreID        string   `json:"storeId"`
	PurchasedAt    string   `json:"purchasedAt"`
	EntryMode      string   `json:"entryMode"`
	UnitPrice      *float64 `json:"unitPrice,omitempty"`
	TotalPrice     *float64 `json:"totalPrice,omitempty"`
	Quantity       *float64 `json:"quantity,omitempty"`
	Unit           string   `json:"unit"`
	PriceKind      string   `json:"priceKind"`
	ReferencePrice *float64 `json:"referencePrice,omitempty"`
	ReferenceUnit  string   `json:"referenceUnit,omitempty"`
	Quality        *int     `json:"quality,omitempty"`
}

type UpdatePriceQualityRequest struct {
	Quality *int `json:"quality"`
}

func (service *Service) GetPriceCatalog(ctx context.Context, token string) (PriceCatalogView, error) {
	family, _, err := service.authenticate(ctx, token)
	if err != nil {
		return PriceCatalogView{}, err
	}
	return buildPriceCatalogView(family), nil
}

func (service *Service) CreateProduct(ctx context.Context, token string, request CreateProductRequest) (PriceCatalogView, error) {
	name, err := validateCatalogName(request.Name, 50)
	if err != nil {
		return PriceCatalogView{}, err
	}
	family, _, err := service.authenticate(ctx, token)
	if err != nil {
		return PriceCatalogView{}, err
	}
	productID, err := randomID("prd_", 7)
	if err != nil {
		return PriceCatalogView{}, err
	}

	family, err = service.store.Update(ctx, family.ID, func(current *Family) error {
		for _, product := range current.Products {
			if equalCatalogName(product.Name, name) {
				return nil
			}
		}
		current.Products = append(current.Products, Product{
			ID:        productID,
			Name:      name,
			IconKey:   strings.TrimSpace(request.IconKey),
			CreatedAt: service.now().UTC(),
		})
		return nil
	})
	if err != nil {
		return PriceCatalogView{}, err
	}
	return buildPriceCatalogView(family), nil
}

func (service *Service) CreatePriceStore(ctx context.Context, token string, request CreatePriceStoreRequest) (PriceCatalogView, error) {
	name, err := validateCatalogName(request.Name, 80)
	if err != nil {
		return PriceCatalogView{}, err
	}
	family, _, err := service.authenticate(ctx, token)
	if err != nil {
		return PriceCatalogView{}, err
	}
	storeID, err := randomID("sto_", 7)
	if err != nil {
		return PriceCatalogView{}, err
	}

	family, err = service.store.Update(ctx, family.ID, func(current *Family) error {
		for _, priceStore := range current.PriceStores {
			if equalCatalogName(priceStore.Name, name) {
				return nil
			}
		}
		current.PriceStores = append(current.PriceStores, PriceStore{
			ID:        storeID,
			Name:      name,
			BrandKey:  strings.TrimSpace(request.BrandKey),
			CreatedAt: service.now().UTC(),
		})
		return nil
	})
	if err != nil {
		return PriceCatalogView{}, err
	}
	return buildPriceCatalogView(family), nil
}

func (service *Service) CreatePriceRecord(ctx context.Context, token string, request SavePriceRecordRequest) (PriceCatalogView, error) {
	family, member, err := service.authenticate(ctx, token)
	if err != nil {
		return PriceCatalogView{}, err
	}
	recordID, err := randomID("price_", 7)
	if err != nil {
		return PriceCatalogView{}, err
	}
	record, err := service.buildPriceRecord(family, request)
	if err != nil {
		return PriceCatalogView{}, err
	}
	now := service.now().UTC()
	record.ID = recordID
	record.MemberID = member.ID
	record.CreatedAt = now
	record.UpdatedAt = now

	family, err = service.store.Update(ctx, family.ID, func(current *Family) error {
		if !priceReferencesExist(*current, record.ProductID, record.StoreID) {
			return fmt.Errorf("%w: product or store does not exist", ErrInvalidInput)
		}
		current.PriceRecords = append(current.PriceRecords, record)
		return nil
	})
	if err != nil {
		return PriceCatalogView{}, err
	}
	return buildPriceCatalogView(family), nil
}

func (service *Service) UpdatePriceRecord(ctx context.Context, token string, recordID string, request SavePriceRecordRequest) (PriceCatalogView, error) {
	recordID = strings.TrimSpace(recordID)
	if recordID == "" {
		return PriceCatalogView{}, fmt.Errorf("%w: price record id is required", ErrInvalidInput)
	}
	family, _, err := service.authenticate(ctx, token)
	if err != nil {
		return PriceCatalogView{}, err
	}
	replacement, err := service.buildPriceRecord(family, request)
	if err != nil {
		return PriceCatalogView{}, err
	}

	family, err = service.store.Update(ctx, family.ID, func(current *Family) error {
		if !priceReferencesExist(*current, replacement.ProductID, replacement.StoreID) {
			return fmt.Errorf("%w: product or store does not exist", ErrInvalidInput)
		}
		for index := range current.PriceRecords {
			existing := current.PriceRecords[index]
			if existing.ID != recordID || existing.DeletedAt != nil {
				continue
			}
			replacement.ID = existing.ID
			replacement.MemberID = existing.MemberID
			replacement.CreatedAt = existing.CreatedAt
			replacement.UpdatedAt = service.now().UTC()
			current.PriceRecords[index] = replacement
			return nil
		}
		return ErrNotFound
	})
	if err != nil {
		return PriceCatalogView{}, err
	}
	return buildPriceCatalogView(family), nil
}

func (service *Service) UpdatePriceQuality(ctx context.Context, token string, recordID string, request UpdatePriceQualityRequest) (PriceCatalogView, error) {
	recordID = strings.TrimSpace(recordID)
	if recordID == "" {
		return PriceCatalogView{}, fmt.Errorf("%w: price record id is required", ErrInvalidInput)
	}
	if request.Quality != nil && (*request.Quality < 1 || *request.Quality > 5) {
		return PriceCatalogView{}, fmt.Errorf("%w: quality must be between 1 and 5", ErrInvalidInput)
	}
	family, _, err := service.authenticate(ctx, token)
	if err != nil {
		return PriceCatalogView{}, err
	}
	family, err = service.store.Update(ctx, family.ID, func(current *Family) error {
		for index := range current.PriceRecords {
			if current.PriceRecords[index].ID != recordID || current.PriceRecords[index].DeletedAt != nil {
				continue
			}
			current.PriceRecords[index].Quality = request.Quality
			current.PriceRecords[index].UpdatedAt = service.now().UTC()
			return nil
		}
		return ErrNotFound
	})
	if err != nil {
		return PriceCatalogView{}, err
	}
	return buildPriceCatalogView(family), nil
}

func (service *Service) DeletePriceRecord(ctx context.Context, token string, recordID string) (PriceCatalogView, error) {
	return service.setPriceRecordDeleted(ctx, token, recordID, true)
}

func (service *Service) RestorePriceRecord(ctx context.Context, token string, recordID string) (PriceCatalogView, error) {
	return service.setPriceRecordDeleted(ctx, token, recordID, false)
}

func (service *Service) setPriceRecordDeleted(ctx context.Context, token string, recordID string, deleted bool) (PriceCatalogView, error) {
	recordID = strings.TrimSpace(recordID)
	if recordID == "" {
		return PriceCatalogView{}, fmt.Errorf("%w: price record id is required", ErrInvalidInput)
	}
	family, _, err := service.authenticate(ctx, token)
	if err != nil {
		return PriceCatalogView{}, err
	}
	family, err = service.store.Update(ctx, family.ID, func(current *Family) error {
		for index := range current.PriceRecords {
			if current.PriceRecords[index].ID != recordID {
				continue
			}
			if deleted {
				now := service.now().UTC()
				current.PriceRecords[index].DeletedAt = &now
			} else {
				current.PriceRecords[index].DeletedAt = nil
			}
			current.PriceRecords[index].UpdatedAt = service.now().UTC()
			return nil
		}
		return ErrNotFound
	})
	if err != nil {
		return PriceCatalogView{}, err
	}
	return buildPriceCatalogView(family), nil
}

func (service *Service) buildPriceRecord(family Family, request SavePriceRecordRequest) (PriceRecord, error) {
	request.ProductID = strings.TrimSpace(request.ProductID)
	request.StoreID = strings.TrimSpace(request.StoreID)
	request.EntryMode = strings.TrimSpace(request.EntryMode)
	request.Unit = strings.TrimSpace(request.Unit)
	request.PriceKind = strings.TrimSpace(request.PriceKind)
	request.ReferenceUnit = strings.TrimSpace(request.ReferenceUnit)
	if !priceReferencesExist(family, request.ProductID, request.StoreID) {
		return PriceRecord{}, fmt.Errorf("%w: product or store does not exist", ErrInvalidInput)
	}

	purchasedAt := service.now().UTC()
	if strings.TrimSpace(request.PurchasedAt) != "" {
		parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(request.PurchasedAt))
		if err != nil {
			return PriceRecord{}, fmt.Errorf("%w: purchasedAt must use RFC3339", ErrInvalidInput)
		}
		purchasedAt = parsed.UTC()
	}

	normalizedPrice, normalizedUnit, err := normalizePrice(request.EntryMode, request.UnitPrice, request.TotalPrice, request.Quantity, request.Unit)
	if err != nil {
		return PriceRecord{}, err
	}
	if request.PriceKind != PriceKindRegular && request.PriceKind != PriceKindDiscount {
		return PriceRecord{}, fmt.Errorf("%w: invalid price kind", ErrInvalidInput)
	}
	if request.Quality != nil && (*request.Quality < 1 || *request.Quality > 5) {
		return PriceRecord{}, fmt.Errorf("%w: quality must be between 1 and 5", ErrInvalidInput)
	}
	if request.PriceKind == PriceKindRegular {
		request.ReferencePrice = nil
		request.ReferenceUnit = ""
	}
	if request.ReferencePrice == nil && request.ReferenceUnit != "" || request.ReferencePrice != nil && request.ReferenceUnit == "" {
		return PriceRecord{}, fmt.Errorf("%w: reference price and unit must be provided together", ErrInvalidInput)
	}
	if request.ReferencePrice != nil {
		if !positiveFinite(*request.ReferencePrice) {
			return PriceRecord{}, fmt.Errorf("%w: reference price must be greater than zero", ErrInvalidInput)
		}
		_, referenceNormalizedUnit, exists := unitFactor(request.ReferenceUnit)
		if !exists || referenceNormalizedUnit != normalizedUnit {
			return PriceRecord{}, fmt.Errorf("%w: reference unit is incompatible", ErrInvalidInput)
		}
	}

	return PriceRecord{
		ProductID:       request.ProductID,
		StoreID:         request.StoreID,
		PurchasedAt:     purchasedAt,
		EntryMode:       request.EntryMode,
		UnitPrice:       request.UnitPrice,
		TotalPrice:      request.TotalPrice,
		Quantity:        request.Quantity,
		Unit:            request.Unit,
		NormalizedPrice: normalizedPrice,
		NormalizedUnit:  normalizedUnit,
		PriceKind:       request.PriceKind,
		ReferencePrice:  request.ReferencePrice,
		ReferenceUnit:   request.ReferenceUnit,
		Quality:         request.Quality,
	}, nil
}

func normalizePrice(entryMode string, unitPrice *float64, totalPrice *float64, quantity *float64, unit string) (float64, string, error) {
	factor, normalizedUnit, exists := unitFactor(unit)
	if !exists {
		return 0, "", fmt.Errorf("%w: unsupported price unit", ErrInvalidInput)
	}
	var normalizedPrice float64
	switch entryMode {
	case PriceEntryUnit:
		if unitPrice == nil || !positiveFinite(*unitPrice) {
			return 0, "", fmt.Errorf("%w: unit price must be greater than zero", ErrInvalidInput)
		}
		if totalPrice != nil {
			return 0, "", fmt.Errorf("%w: total price is not valid in unit price mode", ErrInvalidInput)
		}
		if quantity != nil && !positiveFinite(*quantity) {
			return 0, "", fmt.Errorf("%w: purchase quantity must be greater than zero", ErrInvalidInput)
		}
		normalizedPrice = *unitPrice * factor
	case PriceEntryTotal:
		if totalPrice == nil || !positiveFinite(*totalPrice) || quantity == nil || !positiveFinite(*quantity) {
			return 0, "", fmt.Errorf("%w: total price and quantity must be greater than zero", ErrInvalidInput)
		}
		if unitPrice != nil {
			return 0, "", fmt.Errorf("%w: unit price is not valid in total price mode", ErrInvalidInput)
		}
		normalizedPrice = *totalPrice * factor / *quantity
	default:
		return 0, "", fmt.Errorf("%w: invalid entry mode", ErrInvalidInput)
	}
	if !positiveFinite(normalizedPrice) {
		return 0, "", fmt.Errorf("%w: normalized price is invalid", ErrInvalidInput)
	}
	return normalizedPrice, normalizedUnit, nil
}

func unitFactor(unit string) (float64, string, bool) {
	switch unit {
	case "gram":
		return 500, "jin", true
	case "kilogram":
		return 0.5, "jin", true
	case "jin":
		return 1, "jin", true
	case "milliliter":
		return 1000, "liter", true
	case "liter":
		return 1, "liter", true
	case "piece", "box", "bottle":
		return 1, unit, true
	default:
		return 0, "", false
	}
}

func positiveFinite(value float64) bool {
	return value > 0 && !math.IsInf(value, 0) && !math.IsNaN(value)
}

func validateCatalogName(value string, maximum int) (string, error) {
	value = strings.Join(strings.Fields(value), " ")
	if value == "" || utf8.RuneCountInString(value) > maximum {
		return "", fmt.Errorf("%w: catalog name is required and too long", ErrInvalidInput)
	}
	return value, nil
}

func equalCatalogName(left string, right string) bool {
	return strings.EqualFold(strings.TrimSpace(left), strings.TrimSpace(right))
}

func priceReferencesExist(family Family, productID string, storeID string) bool {
	productExists := false
	for _, product := range family.Products {
		if product.ID == productID {
			productExists = true
			break
		}
	}
	if !productExists {
		return false
	}
	for _, priceStore := range family.PriceStores {
		if priceStore.ID == storeID {
			return true
		}
	}
	return false
}

func buildPriceCatalogView(family Family) PriceCatalogView {
	products := make([]Product, len(family.Products))
	copy(products, family.Products)
	priceStores := make([]PriceStore, len(family.PriceStores))
	copy(priceStores, family.PriceStores)
	records := make([]PriceRecord, 0, len(family.PriceRecords))
	for _, record := range family.PriceRecords {
		if record.DeletedAt == nil {
			records = append(records, record)
		}
	}
	sort.Slice(products, func(left int, right int) bool {
		return products[left].Name < products[right].Name
	})
	sort.Slice(priceStores, func(left int, right int) bool {
		return priceStores[left].Name < priceStores[right].Name
	})
	sort.Slice(records, func(left int, right int) bool {
		if records[left].PurchasedAt.Equal(records[right].PurchasedAt) {
			return records[left].CreatedAt.After(records[right].CreatedAt)
		}
		return records[left].PurchasedAt.After(records[right].PurchasedAt)
	})
	return PriceCatalogView{Products: products, Stores: priceStores, Records: records}
}
