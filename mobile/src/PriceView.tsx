import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { APIClient } from "./api";
import { APIError } from "./api";
import tiaomaLogo from "./assets/tiaoma-logo.svg";
import { IconfontGlyph, productIconfontAssets, storeIconfontAssets } from "./iconfontAssets";
import type { Family, NormalizedPriceUnit, PriceCatalog, PriceRecord, PriceStore, PriceUnit, Product, SavePriceRecordInput } from "./types";

type PriceScreen =
  | { name: "home" }
  | { name: "record"; productId?: string; editId?: string; prefill?: Partial<PriceDraft> }
  | { name: "detail"; productId: string }
  | { name: "compare"; productId: string };

type PriceDraft = {
  productName: string;
  storeName: string;
  entryMode: "unit_price" | "total_price";
  unitPrice: string;
  totalPrice: string;
  quantity: string;
  unit: PriceUnit;
  priceKind: "regular" | "discount";
  referencePrice: string;
  referenceUnit: PriceUnit;
  purchasedAt: string;
};

const unitOptions: Array<{ value: PriceUnit; label: string }> = [
  { value: "gram", label: "克" },
  { value: "kilogram", label: "千克" },
  { value: "jin", label: "斤" },
  { value: "milliliter", label: "毫升" },
  { value: "liter", label: "升" },
  { value: "piece", label: "个" },
  { value: "box", label: "盒" },
  { value: "bottle", label: "瓶" },
];

const presetStoreNames = ["永辉超市", "盒马", "条马鲜生", "菜市场", "路边摊", "新世纪超市"];

const normalizedLabels: Record<NormalizedPriceUnit, string> = {
  jin: "斤",
  liter: "升",
  piece: "个",
  box: "盒",
  bottle: "瓶",
};

function emptyDraft(productName = "", unit: PriceUnit = "jin"): PriceDraft {
  return {
    productName,
    storeName: "",
    entryMode: "unit_price",
    unitPrice: "",
    totalPrice: "",
    quantity: "",
    unit,
    priceKind: "regular",
    referencePrice: "",
    referenceUnit: unit,
    purchasedAt: toLocalInput(new Date()),
  };
}

export function PriceView({ client, family }: { client: APIClient; family: Family }) {
  const [catalog, setCatalog] = useState<PriceCatalog | null>(null);
  const [screen, setScreen] = useState<PriceScreen>({ name: "home" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [recentProducts, setRecentProducts] = useState<string[]>([]);
  const [deletedRecordID, setDeletedRecordID] = useState("");

  useEffect(() => {
    let current = true;
    setLoading(true);
    client.prices().then((value) => {
      if (current) setCatalog(value);
    }).catch((reason) => {
      if (current) setError(messageOf(reason));
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [client]);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  }

  async function perform(action: () => Promise<PriceCatalog>, success = "") {
    setLoading(true);
    setError("");
    try {
      const next = await action();
      setCatalog(next);
      if (success) showNotice(success);
      return next;
    } catch (reason) {
      setError(messageOf(reason));
      throw reason;
    } finally {
      setLoading(false);
    }
  }

  async function ensureProduct(name: string) {
    const existing = catalog?.products.find((product) => sameName(product.name, name));
    if (existing) return existing;
    const next = await perform(() => client.createProduct(name, productIconKey(name)));
    const created = next.products.find((product) => sameName(product.name, name));
    if (!created) throw new Error("商品添加失败，请重试");
    return created;
  }

  async function ensureStore(name: string) {
    const existing = catalog?.stores.find((store) => sameName(store.name, name));
    if (existing) return existing;
    const next = await perform(() => client.createPriceStore(name, storeBrandKey(name)));
    const created = next.stores.find((store) => sameName(store.name, name));
    if (!created) throw new Error("店铺添加失败，请重试");
    return created;
  }

  function openProduct(productID: string) {
    setRecentProducts((current) => [productID, ...current.filter((id) => id !== productID)].slice(0, 8));
    setScreen({ name: "detail", productId: productID });
  }

  async function removeRecord(recordID: string) {
    const confirmed = window.confirm("确认删除这条价格记录吗？删除后可在当前提示中撤销。");
    if (!confirmed) return;
    try {
      await perform(() => client.deletePriceRecord(recordID));
      setDeletedRecordID(recordID);
      showNotice("记录已删除");
      window.setTimeout(() => setDeletedRecordID((current) => current === recordID ? "" : current), 5000);
    } catch {
      // perform already presents the request error.
    }
  }

  async function restoreDeleted() {
    if (!deletedRecordID) return;
    try {
      await perform(() => client.restorePriceRecord(deletedRecordID), "已撤销删除");
      setDeletedRecordID("");
    } catch {
      // perform already presents the request error.
    }
  }

  if (!catalog) {
    return <div className="price-page"><PriceHeader title="记录菜价" /><div className="card price-empty">{loading ? "正在加载家庭菜价…" : error || "暂时没有菜价数据"}</div></div>;
  }

  return (
    <div className="price-page">
      {notice && <div className="price-notice">{notice}{deletedRecordID && <button onClick={() => void restoreDeleted()}>撤销</button>}</div>}
      {error && <div className="inline-error price-error">{error}<button onClick={() => setError("")}>×</button></div>}
      {screen.name === "home" && (
        <PriceHome
          catalog={catalog}
          recentProducts={recentProducts}
          loading={loading}
          onOpen={openProduct}
          onRecord={(productId) => setScreen({ name: "record", productId })}
          onAdd={async (name) => {
            const product = await ensureProduct(name);
            setScreen({ name: "record", productId: product.id });
          }}
          onQuality={async (recordID, quality) => {
            try {
              return await perform(() => client.updatePriceQuality(recordID, quality), "品质已补充");
            } catch {
              return catalog;
            }
          }}
        />
      )}
      {screen.name === "record" && (
        <PriceEditor
          catalog={catalog}
          productId={screen.productId}
          editRecord={screen.editId ? catalog.records.find((record) => record.id === screen.editId) : undefined}
          prefill={screen.prefill}
          loading={loading}
          onBack={() => screen.productId ? openProduct(screen.productId) : setScreen({ name: "home" })}
          ensureProduct={ensureProduct}
          ensureStore={ensureStore}
          onSave={async (input, editID) => {
            const next = await perform(
              () => editID ? client.updatePriceRecord(editID, input) : client.createPriceRecord(input),
              editID ? "价格记录已更新" : "菜价已保存",
            );
            return next;
          }}
          onUndo={(recordID) => perform(() => client.deletePriceRecord(recordID), "已撤销上一条保存")}
          onDone={(productID) => openProduct(productID)}
        />
      )}
      {screen.name === "detail" && (
        <ProductDetail
          catalog={catalog}
          family={family}
          productId={screen.productId}
          loading={loading}
          onBack={() => setScreen({ name: "home" })}
          onRecord={() => setScreen({ name: "record", productId: screen.productId })}
          onCompare={() => setScreen({ name: "compare", productId: screen.productId })}
          onEdit={(recordID) => setScreen({ name: "record", productId: screen.productId, editId: recordID })}
          onDelete={(recordID) => void removeRecord(recordID)}
          onQuality={async (recordID, quality) => {
            try {
              return await perform(() => client.updatePriceQuality(recordID, quality), quality ? "品质已更新" : "品质评分已清除");
            } catch {
              return catalog;
            }
          }}
        />
      )}
      {screen.name === "compare" && (
        <ComparePrice
          catalog={catalog}
          productId={screen.productId}
          onBack={() => openProduct(screen.productId)}
          onRecord={(prefill) => setScreen({ name: "record", productId: screen.productId, prefill })}
        />
      )}
      {loading && <div className="price-loading" />}
    </div>
  );
}

function PriceHome(props: {
  catalog: PriceCatalog;
  recentProducts: string[];
  loading: boolean;
  onOpen: (id: string) => void;
  onRecord: (id?: string) => void;
  onAdd: (name: string) => Promise<void>;
  onQuality: (recordID: string, quality: number) => Promise<PriceCatalog>;
}) {
  const { catalog } = props;
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const common = commonProducts(catalog).slice(0, 8);
  const recent = props.recentProducts.flatMap((id) => catalog.products.find((product) => product.id === id) ?? []).slice(0, 8);
  const visible = query.trim()
    ? catalog.products.filter((product) => product.name.includes(query.trim())).slice(0, 8)
    : common.length > 0 ? common : recent;
  const exact = catalog.products.some((product) => sameName(product.name, query));
  const recentRecords = [...catalog.records].sort((left, right) => right.purchasedAt.localeCompare(left.purchasedAt)).slice(0, 8);

  async function addProduct() {
    if (!query.trim()) return;
    setAdding(true);
    try {
      await props.onAdd(query.trim());
    } catch {
      // The parent displays the request error.
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="price-stack">
      <PriceHeader title="记录菜价" subtitle="家庭自己的价格记忆，买菜时随手查、顺手记。" />
      <section className="price-search-card">
        <div className="search-field"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索商品，例如番茄、猪里脊" /></div>
        {query.trim() && visible.length === 0 && !exact && <button className="price-add-result" disabled={adding} onClick={() => void addProduct()}>＋ 添加商品“{query.trim()}”</button>}
        {query.trim() && visible.length > 0 && <div className="price-search-results">{visible.map((product) => <ProductSearchRow key={product.id} product={product} catalog={catalog} onClick={() => props.onOpen(product.id)} />)}{!exact && <button onClick={() => void addProduct()}>＋ 添加商品“{query.trim()}”</button>}</div>}
      </section>

      {!query.trim() && <section className="price-section"><div className="price-section-head"><div><span>QUICK PICKS</span><h2>{common.length ? "常用商品" : "最近查看"}</h2></div><small>近 30 天自动排序</small></div>{visible.length ? <div className="quick-grid">{visible.map((product) => <button key={product.id} onClick={() => props.onOpen(product.id)}><ProductIcon product={product} /><span>{product.name}</span></button>)}</div> : <div className="price-empty compact">保存第一条菜价后，常用商品会自动出现在这里。</div>}</section>}

      <button className="record-price-main" disabled={props.loading} onClick={() => props.onRecord()}><span>＋</span><div><b>记录菜价</b><small>单价、总价都能快速录入</small></div></button>

      {recentRecords.length > 0 && <section className="price-section"><div className="price-section-head"><div><span>RECENT PURCHASES</span><h2>最近记录</h2></div><small>最近 {recentRecords.length} 条</small></div><div className="recent-purchases">{recentRecords.map((record) => <RecentPurchase key={record.id} record={record} catalog={catalog} onQuality={props.onQuality} />)}</div></section>}
    </div>
  );
}

function ProductSearchRow({ product, catalog, onClick }: { product: Product; catalog: PriceCatalog; onClick: () => void }) {
  const summary = productPriceSummary(product.id, catalog);
  return <button className="product-search-row" onClick={onClick}><ProductIcon product={product} /><span><b>{product.name}</b><small>{summary.storeCount} 家店 · {summary.latestAt ? relativeDate(summary.latestAt) : "还没有价格记录"}</small></span><strong>{summary.range}</strong></button>;
}

function RecentPurchase({ record, catalog, onQuality }: { record: PriceRecord; catalog: PriceCatalog; onQuality: (recordID: string, quality: number) => Promise<PriceCatalog> }) {
  const product = catalog.products.find((item) => item.id === record.productId);
  const store = catalog.stores.find((item) => item.id === record.storeId);
  return <article><div className="recent-purchase-copy"><b>{product?.name ?? "未知商品"}</b><span>{store?.name ?? "未知店铺"} · {formatPurchaseDate(record.purchasedAt)}</span><small>{entryDescription(record)}</small></div><div className="recent-purchase-value"><strong>{formatMoney(record.normalizedPrice)} 元/{normalizedLabels[record.normalizedUnit]}</strong><span>品质（选填）</span><StarRating value={record.quality} onChange={(value) => void onQuality(record.id, value)} /></div></article>;
}

function PriceEditor(props: {
  catalog: PriceCatalog;
  productId?: string;
  editRecord?: PriceRecord;
  prefill?: Partial<PriceDraft>;
  loading: boolean;
  onBack: () => void;
  ensureProduct: (name: string) => Promise<Product>;
  ensureStore: (name: string) => Promise<PriceStore>;
  onSave: (input: SavePriceRecordInput, editID?: string) => Promise<PriceCatalog>;
  onUndo: (recordID: string) => Promise<PriceCatalog>;
  onDone: (productID: string) => void;
}) {
  const initialProduct = props.catalog.products.find((product) => product.id === (props.editRecord?.productId ?? props.productId));
  const initialStore = props.catalog.stores.find((store) => store.id === props.editRecord?.storeId);
  const [draft, setDraft] = useState<PriceDraft>(() => {
    if (props.editRecord) return recordDraft(props.editRecord, initialProduct?.name ?? "", initialStore?.name ?? "");
    return { ...emptyDraft(initialProduct?.name), ...props.prefill };
  });
  const [formError, setFormError] = useState("");
  const [savedCount, setSavedCount] = useState(0);
  const [lastSaved, setLastSaved] = useState<{ id: string; draft: PriceDraft } | null>(null);
  const productInput = useRef<HTMLInputElement>(null);
  const normalized = normalizeDraft(draft);
  const purchaseTotal = draft.entryMode === "unit_price" && Number(draft.unitPrice) > 0 && Number(draft.quantity) > 0 ? Number(draft.unitPrice) * Number(draft.quantity) : 0;

  async function submit(event: { preventDefault: () => void }, addAnother: boolean) {
    event.preventDefault();
    setFormError("");
    if (!draft.productName.trim() || !draft.storeName.trim()) {
      setFormError("商品和店铺都需要填写");
      return;
    }
    if (!normalized) {
      setFormError(draft.entryMode === "unit_price" ? "请输入大于 0 的单价" : "总价和数量都必须大于 0");
      return;
    }
    if (draft.entryMode === "unit_price" && draft.quantity.trim() && Number(draft.quantity) <= 0) {
      setFormError("购买数量必须大于 0，也可以直接留空");
      return;
    }
    if (draft.priceKind === "discount" && draft.referencePrice && Number(draft.referencePrice) <= 0) {
      setFormError("原价必须大于 0，也可以直接留空");
      return;
    }

    let product: Product;
    let store: PriceStore;
    try {
      product = await props.ensureProduct(draft.productName.trim());
      store = await props.ensureStore(draft.storeName.trim());
    } catch (reason) {
      setFormError(messageOf(reason));
      return;
    }
    const history = props.catalog.records.filter((record) => record.productId === product.id && record.normalizedUnit === normalized.unit && record.id !== props.editRecord?.id);
    const warning = anomalyWarning(normalized.price, normalized.unit, history);
    if (warning && !window.confirm(`${warning}\n\n单位选择无误时可以继续保存。`)) return;

    const input = buildRecordInput(draft, product.id, store.id);
    try {
      const next = await props.onSave(input, props.editRecord?.id);
      const saved = props.editRecord ?? next.records.find((record) => record.productId === product.id && record.storeId === store.id && record.createdAt === next.records.filter((item) => item.productId === product.id && item.storeId === store.id)[0]?.createdAt);
      if (props.editRecord || !addAnother) {
        props.onDone(product.id);
        return;
      }
      const newest = next.records.filter((record) => record.productId === product.id && record.storeId === store.id).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? saved;
      setLastSaved(newest ? { id: newest.id, draft } : null);
      setSavedCount((count) => count + 1);
      setDraft({ ...emptyDraft("", draft.unit), storeName: store.name, purchasedAt: toLocalInput(new Date()) });
      window.setTimeout(() => productInput.current?.focus(), 0);
    } catch (reason) {
      setFormError(messageOf(reason));
    }
  }

  async function undoSaved() {
    if (!lastSaved) return;
    try {
      await props.onUndo(lastSaved.id);
      setDraft(lastSaved.draft);
      setSavedCount((count) => Math.max(0, count - 1));
      setLastSaved(null);
    } catch (reason) {
      setFormError(messageOf(reason));
    }
  }

  return (
    <form className="price-stack price-editor" onSubmit={(event) => void submit(event, false)}>
      <SubpageHeader title={props.editRecord ? "编辑价格记录" : "记录菜价"} eyebrow={savedCount ? `本次已记录 ${savedCount} 项` : "QUICK ENTRY"} onBack={props.onBack} />
      {lastSaved && <div className="save-undo">上一项已保存 <button type="button" onClick={() => void undoSaved()}>恢复表单</button></div>}
      <section className="card price-form-card">
        <CatalogInput inputRef={productInput} label="商品" placeholder="搜索或添加商品" value={draft.productName} items={props.catalog.products.map((item) => item.name)} onChange={(value) => setDraft({ ...draft, productName: value })} />
        <div className="quick-chips">{commonProducts(props.catalog).slice(0, 8).map((product) => <button type="button" key={product.id} onClick={() => setDraft({ ...draft, productName: product.name })}>{product.name}</button>)}</div>
        <CatalogInput label="店铺" placeholder="搜索或添加店铺，可包含分店名" value={draft.storeName} items={props.catalog.stores.map((item) => item.name)} onChange={(value) => setDraft({ ...draft, storeName: value })} />
        <div className="quick-chips store-chips">{storeChipOptions(props.catalog).map((store) => <button type="button" key={store.id} onClick={() => setDraft({ ...draft, storeName: store.name })}><StoreIcon store={store} compact /><span>{store.name}</span></button>)}</div>
      </section>

      <section className="card price-form-card">
        <Segmented value={draft.entryMode} options={[{ value: "unit_price", label: "按单价" }, { value: "total_price", label: "按总价" }]} onChange={(value) => setDraft({ ...draft, entryMode: value as PriceDraft["entryMode"] })} />
        {draft.entryMode === "unit_price" ? <div className="unit-price-fields"><div className="price-number-row"><label>单价<input inputMode="decimal" type="number" min="0" step="0.01" placeholder="0.00" value={draft.unitPrice} onChange={(event) => setDraft({ ...draft, unitPrice: event.target.value })} /></label><UnitSelect value={draft.unit} prefix="元 /" onChange={(unit) => setDraft({ ...draft, unit, referenceUnit: unit })} /></div><label>购买数量（选填）<span className="quantity-input"><input inputMode="decimal" type="number" min="0" step="0.001" placeholder="不知道可留空" value={draft.quantity} onChange={(event) => setDraft({ ...draft, quantity: event.target.value })} /><em>{unitLabel(draft.unit)}</em></span></label></div> : <div className="price-total-grid"><label>总价（元）<input inputMode="decimal" type="number" min="0" step="0.01" placeholder="0.00" value={draft.totalPrice} onChange={(event) => setDraft({ ...draft, totalPrice: event.target.value })} /></label><label>数量<input inputMode="decimal" type="number" min="0" step="0.001" placeholder="0" value={draft.quantity} onChange={(event) => setDraft({ ...draft, quantity: event.target.value })} /></label><UnitSelect value={draft.unit} onChange={(unit) => setDraft({ ...draft, unit, referenceUnit: unit })} /></div>}
        <div className={`normalized-preview ${normalized ? "ready" : ""}`}><div><span>统一单价</span>{purchaseTotal > 0 && <small>本次合计 {formatMoney(purchaseTotal)} 元</small>}</div><strong>{normalized ? `${formatMoney(normalized.price)} 元 / ${normalizedLabels[normalized.unit]}` : "填写后自动换算"}</strong></div>
      </section>

      <section className="card price-form-card">
        <Segmented value={draft.priceKind} options={[{ value: "regular", label: "日常价" }, { value: "discount", label: "优惠价" }]} onChange={(value) => setDraft({ ...draft, priceKind: value as PriceDraft["priceKind"], referencePrice: value === "regular" ? "" : draft.referencePrice })} />
        {draft.priceKind === "discount" && <div className="reference-row"><label>原价（选填）<input inputMode="decimal" type="number" min="0" step="0.01" placeholder="不知道可留空" value={draft.referencePrice} onChange={(event) => setDraft({ ...draft, referencePrice: event.target.value })} /></label><UnitSelect value={draft.referenceUnit} prefix="元 /" onChange={(referenceUnit) => setDraft({ ...draft, referenceUnit })} /></div>}
        <label>购买时间<input type="datetime-local" value={draft.purchasedAt} onChange={(event) => setDraft({ ...draft, purchasedAt: event.target.value })} /></label>
      </section>
      {formError && <div className="inline-error">{formError}</div>}
      <div className="price-actions"><button type="submit" className="primary" disabled={props.loading}>保存</button>{!props.editRecord && <button type="button" className="secondary" disabled={props.loading} onClick={(event) => void submit(event, true)}>保存并新增</button>}</div>
    </form>
  );
}

function ProductDetail(props: {
  catalog: PriceCatalog;
  family: Family;
  productId: string;
  loading: boolean;
  onBack: () => void;
  onRecord: () => void;
  onCompare: () => void;
  onEdit: (recordID: string) => void;
  onDelete: (recordID: string) => void;
  onQuality: (recordID: string, quality?: number) => Promise<PriceCatalog>;
}) {
  const product = props.catalog.products.find((item) => item.id === props.productId);
  const allRecords = props.catalog.records.filter((record) => record.productId === props.productId);
  const units = [...new Set(allRecords.map((record) => record.normalizedUnit))];
  const [unit, setUnit] = useState<NormalizedPriceUnit>(() => allRecords[0]?.normalizedUnit ?? "jin");
  const [historyOpen, setHistoryOpen] = useState(false);
  const records = allRecords.filter((record) => record.normalizedUnit === unit);
  const latest = latestByStore(records).sort((left, right) => left.normalizedPrice - right.normalizedPrice);
  const prices = latest.map((record) => record.normalizedPrice);
  const storeByID = Object.fromEntries(props.catalog.stores.map((store) => [store.id, store]));
  const memberByID = Object.fromEntries(props.family.members.map((member) => [member.id, member]));

  if (!product) return <div className="price-stack"><SubpageHeader title="商品不存在" eyebrow="PRICE" onBack={props.onBack} /></div>;

  return (
    <div className="price-stack">
      <SubpageHeader title={product.name} eyebrow="PRICE MEMORY" onBack={props.onBack} />
      <section className="price-summary-card"><ProductIcon product={product} large /><div><span>各店最新价格</span><strong>{prices.length ? `${formatMoney(Math.min(...prices))}—${formatMoney(Math.max(...prices))}` : "暂无记录"}</strong><small>{prices.length ? `元 / ${normalizedLabels[unit]} · ${latest.length} 家店` : "记录一次后即可开始比较"}</small></div></section>
      {units.length > 1 && <div className="unit-tabs">{units.map((item) => <button key={item} className={unit === item ? "active" : ""} onClick={() => setUnit(item)}>{normalizedLabels[item]}</button>)}</div>}
      <div className="detail-actions"><button onClick={props.onRecord}>＋ 记录新价格</button><button onClick={props.onCompare}>⌁ 现场比价</button></div>

      <section className="price-section"><div className="price-section-head"><div><span>LATEST BY STORE</span><h2>各店最新价格</h2></div></div>{latest.length ? <div className="store-price-list">{latest.map((record) => <article key={record.id} className={isOlder(record.purchasedAt) ? "stale" : ""}><StoreIcon store={storeByID[record.storeId]} /><div className="store-price-main"><h3>{storeByID[record.storeId]?.name ?? "未知店铺"}</h3><p>{formatPurchaseDate(record.purchasedAt)} · {memberByID[record.memberId]?.name ?? "家庭成员"}{isOlder(record.purchasedAt) && <em>较早记录</em>}</p><p className="purchase-detail">{entryDescription(record)}</p><div className="quality-line"><StarRating value={record.quality} onChange={(quality) => void props.onQuality(record.id, quality)} /><button onClick={() => void props.onQuality(record.id, undefined)}>{record.quality ? "清除" : "补充品质"}</button></div></div><div className="store-price-value"><strong>{formatMoney(record.normalizedPrice)}</strong><span>元/{normalizedLabels[record.normalizedUnit]}</span>{record.priceKind === "discount" && <em>优惠价{record.referencePrice ? ` · 原价 ${formatMoney(record.referencePrice)} 元/${unitLabel(record.referenceUnit)}` : " · 无原价"}</em>}</div></article>)}</div> : <div className="price-empty compact">还没有可比较的店铺价格。</div>}</section>

      <PriceTrend records={records} stores={props.catalog.stores} />

      <section className="price-section"><button className="history-toggle" onClick={() => setHistoryOpen((value) => !value)}><span><b>历史记录与纠错</b><small>{allRecords.length} 条记录，按购买时间倒序</small></span><em>{historyOpen ? "⌃" : "⌄"}</em></button>{historyOpen && <div className="price-history">{allRecords.map((record) => <article key={record.id}><div><b>{storeByID[record.storeId]?.name ?? "未知店铺"}</b><span>{formatPurchaseDate(record.purchasedAt)} · {entryDescription(record)}</span></div><strong>{formatMoney(record.normalizedPrice)} 元/{normalizedLabels[record.normalizedUnit]}</strong><div className="history-buttons"><button disabled={props.loading} onClick={() => props.onEdit(record.id)}>编辑</button><button disabled={props.loading} onClick={() => props.onDelete(record.id)}>删除</button></div></article>)}</div>}</section>
    </div>
  );
}

function ComparePrice({ catalog, productId, onBack, onRecord }: { catalog: PriceCatalog; productId: string; onBack: () => void; onRecord: (prefill: Partial<PriceDraft>) => void }) {
  const product = catalog.products.find((item) => item.id === productId);
  const [draft, setDraft] = useState<PriceDraft>(() => emptyDraft(product?.name));
  const normalized = normalizeDraft(draft);
  const matching = normalized ? latestByStore(catalog.records.filter((record) => record.productId === productId && record.normalizedUnit === normalized.unit)).sort((left, right) => left.normalizedPrice - right.normalizedPrice) : [];
  const lowest = matching[0];
  const highest = matching[matching.length - 1];
  return <div className="price-stack"><SubpageHeader title="现场比价" eyebrow={product?.name ?? "PRICE CHECK"} onBack={onBack} /><section className="card compare-card"><Segmented value={draft.entryMode} options={[{ value: "unit_price", label: "按单价" }, { value: "total_price", label: "按总价" }]} onChange={(value) => setDraft({ ...draft, entryMode: value as PriceDraft["entryMode"] })} />{draft.entryMode === "unit_price" ? <div className="price-number-row"><label>标签单价<input type="number" inputMode="decimal" min="0" step="0.01" value={draft.unitPrice} onChange={(event) => setDraft({ ...draft, unitPrice: event.target.value })} /></label><UnitSelect value={draft.unit} prefix="元 /" onChange={(unit) => setDraft({ ...draft, unit })} /></div> : <div className="price-total-grid"><label>总价（元）<input type="number" inputMode="decimal" min="0" step="0.01" value={draft.totalPrice} onChange={(event) => setDraft({ ...draft, totalPrice: event.target.value })} /></label><label>数量<input type="number" inputMode="decimal" min="0" step="0.001" value={draft.quantity} onChange={(event) => setDraft({ ...draft, quantity: event.target.value })} /></label><UnitSelect value={draft.unit} onChange={(unit) => setDraft({ ...draft, unit })} /></div>}</section>{normalized && <section className="compare-result"><span>换算结果</span><strong>{formatMoney(normalized.price)} 元 / {normalizedLabels[normalized.unit]}</strong>{lowest ? <div className="compare-lines"><p className={normalized.price <= lowest.normalizedPrice ? "better" : ""}>{differenceFrom(normalized.price, lowest.normalizedPrice, "当前最低价", normalized.unit)}</p>{highest && highest.id !== lowest.id && <p>{differenceFrom(normalized.price, highest.normalizedPrice, "当前最高价", normalized.unit)}</p>}</div> : <p>还没有相同单位的历史价格，这次记录会成为第一条参考。</p>}<button onClick={() => onRecord(draft)}>记录此价格</button></section>}</div>;
}

function PriceTrend({ records, stores }: { records: PriceRecord[]; stores: PriceStore[] }) {
  const [storeID, setStoreID] = useState("all");
  const visible = records.filter((record) => storeID === "all" || record.storeId === storeID).sort((left, right) => left.purchasedAt.localeCompare(right.purchasedAt));
  const usedStores = stores.filter((store) => records.some((record) => record.storeId === store.id));
  const width = 520;
  const height = 190;
  const padding = 28;
  const times = visible.map((record) => new Date(record.purchasedAt).getTime());
  const values = visible.map((record) => record.normalizedPrice);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const minimum = values.length ? Math.min(...values) : 0;
  const maximum = values.length ? Math.max(...values) : 1;
  const x = (record: PriceRecord) => maxTime === minTime ? width / 2 : padding + (new Date(record.purchasedAt).getTime() - minTime) / (maxTime - minTime) * (width - padding * 2);
  const y = (record: PriceRecord) => maximum === minimum ? height / 2 : padding + (maximum - record.normalizedPrice) / (maximum - minimum) * (height - padding * 2);
  const colors = ["#d36f57", "#4d9881", "#6f88bb", "#c18a45", "#946da8"];
  return <section className="price-section trend-section"><div className="price-section-head"><div><span>PRICE TREND</span><h2>价格趋势</h2></div><select value={storeID} onChange={(event) => setStoreID(event.target.value)}><option value="all">全部店铺</option>{usedStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></div>{visible.length < 2 ? <div className="price-empty compact">记录不足，继续记录后可查看变化。</div> : <><svg className="price-trend" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="商品价格趋势图"><line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} className="trend-axis" />{usedStores.filter((store) => storeID === "all" || store.id === storeID).map((store, index) => { const points = visible.filter((record) => record.storeId === store.id); return <g key={store.id}><polyline points={points.map((record) => `${x(record)},${y(record)}`).join(" ")} fill="none" stroke={colors[index % colors.length]} strokeWidth="3" />{points.map((record) => <circle key={record.id} cx={x(record)} cy={y(record)} r={record.priceKind === "discount" ? 6 : 4} fill={record.priceKind === "discount" ? "#fff" : colors[index % colors.length]} stroke={colors[index % colors.length]} strokeWidth="3" />)}</g>; })}</svg><div className="trend-legend">{usedStores.filter((store) => storeID === "all" || store.id === storeID).map((store, index) => <span key={store.id}><i style={{ background: colors[index % colors.length] }} />{store.name}</span>)}<em>空心大点为优惠价</em></div></>}</section>;
}

function CatalogInput({ label, placeholder, value, items, onChange, inputRef }: { label: string; placeholder: string; value: string; items: string[]; onChange: (value: string) => void; inputRef?: RefObject<HTMLInputElement | null> }) {
  const [focused, setFocused] = useState(false);
  const matches = items.filter((item) => !value.trim() || item.includes(value.trim())).slice(0, 5);
  const exact = items.some((item) => sameName(item, value));
  return <label className="catalog-input">{label}<div className="search-field"><span aria-hidden="true">⌕</span><input ref={inputRef} value={value} placeholder={placeholder} onFocus={() => setFocused(true)} onChange={(event) => { onChange(event.target.value); setFocused(true); }} onBlur={() => window.setTimeout(() => setFocused(false), 120)} /></div>{focused && <div className="catalog-suggestions">{matches.map((item) => <button type="button" key={item} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(item); setFocused(false); }}>{item}</button>)}{value.trim() && !exact && <button type="button" className="add" onMouseDown={(event) => event.preventDefault()} onClick={() => setFocused(false)}>＋ 保存时添加“{value.trim()}”</button>}</div>}</label>;
}

function Segmented({ value, options, onChange }: { value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return <div className="price-segmented">{options.map((option) => <button type="button" key={option.value} className={value === option.value ? "active" : ""} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>;
}

function UnitSelect({ value, onChange, prefix = "" }: { value: PriceUnit; onChange: (unit: PriceUnit) => void; prefix?: string }) {
  return <label>单位<select value={value} onChange={(event) => onChange(event.target.value as PriceUnit)}>{unitOptions.map((unit) => <option key={unit.value} value={unit.value}>{prefix}{unit.label}</option>)}</select></label>;
}

function StarRating({ value, onChange }: { value?: number; onChange: (value: number) => void }) {
  return <div className="star-rating" aria-label="品质星级">{[1, 2, 3, 4, 5].map((star) => <button type="button" key={star} className={(value ?? 0) >= star ? "active" : ""} onClick={() => onChange(star)} aria-label={`${star} 星`}>★</button>)}</div>;
}

function PriceHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return <div className="price-heading"><span>FAMILY MARKET NOTE</span><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>;
}

function SubpageHeader({ title, eyebrow, onBack }: { title: string; eyebrow: string; onBack: () => void }) {
  return <div className="price-subhead"><button onClick={onBack} aria-label="返回"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg></button><div><span>{eyebrow}</span><h2>{title}</h2></div></div>;
}

function ProductIcon({ product, large = false }: { product: Product; large?: boolean }) {
  const inferredKey = productIconKey(product.name);
  const storedKey = product.iconKey ?? "";
  const key = productIconfontAssets[inferredKey] ? inferredKey : productIconfontAssets[storedKey] ? storedKey : "fallback";
  const asset = productIconfontAssets[key];
  return <i className={`product-icon icon-${key} ${large ? "large" : ""}`}>{asset ? <IconfontGlyph asset={asset} /> : <span className="product-fallback">{product.name.trim().slice(0, 1) || "物"}</span>}</i>;
}

function StoreIcon({ store, compact = false }: { store?: PriceStore; compact?: boolean }) {
  const inferredBrand = storeBrandKey(store?.name ?? "");
  const brand = inferredBrand !== "store" ? inferredBrand : store?.brandKey || "store";
  const asset = storeIconfontAssets[brand];
  const text: Record<string, string> = { xinshiji: "新", kebainian: "客", qiandama: "钱" };
  return <i className={`store-icon brand-${brand} ${compact ? "compact" : ""}`}>{brand === "tiaoma" ? <img src={tiaomaLogo} alt="" /> : asset ? <IconfontGlyph asset={asset} /> : <span>{text[brand] ?? store?.name.trim().slice(0, 1) ?? "店"}</span>}</i>;
}

function normalizeDraft(draft: Pick<PriceDraft, "entryMode" | "unitPrice" | "totalPrice" | "quantity" | "unit">): { price: number; unit: NormalizedPriceUnit } | null {
  const factors: Record<PriceUnit, { factor: number; unit: NormalizedPriceUnit }> = {
    gram: { factor: 500, unit: "jin" }, kilogram: { factor: 0.5, unit: "jin" }, jin: { factor: 1, unit: "jin" },
    milliliter: { factor: 1000, unit: "liter" }, liter: { factor: 1, unit: "liter" }, piece: { factor: 1, unit: "piece" }, box: { factor: 1, unit: "box" }, bottle: { factor: 1, unit: "bottle" },
  };
  const conversion = factors[draft.unit];
  if (draft.entryMode === "unit_price") {
    const value = Number(draft.unitPrice);
    return value > 0 ? { price: value * conversion.factor, unit: conversion.unit } : null;
  }
  const total = Number(draft.totalPrice);
  const quantity = Number(draft.quantity);
  return total > 0 && quantity > 0 ? { price: total * conversion.factor / quantity, unit: conversion.unit } : null;
}

function buildRecordInput(draft: PriceDraft, productId: string, storeId: string): SavePriceRecordInput {
  return {
    productId,
    storeId,
    purchasedAt: new Date(draft.purchasedAt).toISOString(),
    entryMode: draft.entryMode,
    ...(draft.entryMode === "unit_price" ? { unitPrice: Number(draft.unitPrice), ...(draft.quantity.trim() ? { quantity: Number(draft.quantity) } : {}) } : { totalPrice: Number(draft.totalPrice), quantity: Number(draft.quantity) }),
    unit: draft.unit,
    priceKind: draft.priceKind,
    ...(draft.priceKind === "discount" && draft.referencePrice ? { referencePrice: Number(draft.referencePrice), referenceUnit: draft.referenceUnit } : {}),
  };
}

function recordDraft(record: PriceRecord, productName: string, storeName: string): PriceDraft {
  return {
    productName,
    storeName,
    entryMode: record.entryMode,
    unitPrice: record.unitPrice?.toString() ?? "",
    totalPrice: record.totalPrice?.toString() ?? "",
    quantity: record.quantity?.toString() ?? "",
    unit: record.unit,
    priceKind: record.priceKind,
    referencePrice: record.referencePrice?.toString() ?? "",
    referenceUnit: record.referenceUnit ?? record.unit,
    purchasedAt: toLocalInput(new Date(record.purchasedAt)),
  };
}

function commonProducts(catalog: PriceCatalog) {
  const ranked = usageRanking(catalog.records, (record) => record.productId);
  return catalog.products.filter((product) => ranked.has(product.id)).sort((left, right) => compareRanking(ranked, left.id, right.id));
}

function commonStores(catalog: PriceCatalog) {
  const ranked = usageRanking(catalog.records, (record) => record.storeId);
  return catalog.stores.filter((store) => ranked.has(store.id)).sort((left, right) => compareRanking(ranked, left.id, right.id));
}

function storeChipOptions(catalog: PriceCatalog) {
  const common = commonStores(catalog);
  const used = new Set<string>();
  const presets = presetStoreNames.map((name) => {
    const brand = storeBrandKey(name);
    const existing = common.find((store) => !used.has(store.id) && storeBrandKey(store.name) === brand);
    if (existing) {
      used.add(existing.id);
      return existing;
    }
    return { id: `preset-${brand}`, name, brandKey: brand, createdAt: "" } satisfies PriceStore;
  });
  return [...presets, ...common.filter((store) => !used.has(store.id))].slice(0, 8);
}

function usageRanking(records: PriceRecord[], keyOf: (record: PriceRecord) => string) {
  const cutoff = Date.now() - 30 * 86_400_000;
  const ranked = new Map<string, { count: number; latest: number }>();
  for (const record of records) {
    const usedAt = new Date(record.purchasedAt).getTime();
    if (usedAt < cutoff) continue;
    const key = keyOf(record);
    const current = ranked.get(key) ?? { count: 0, latest: 0 };
    ranked.set(key, { count: current.count + 1, latest: Math.max(current.latest, usedAt) });
  }
  return ranked;
}

function compareRanking(ranked: Map<string, { count: number; latest: number }>, left: string, right: string) {
  const a = ranked.get(left) ?? { count: 0, latest: 0 };
  const b = ranked.get(right) ?? { count: 0, latest: 0 };
  return b.count - a.count || b.latest - a.latest;
}

function latestByStore(records: PriceRecord[]) {
  const result = new Map<string, PriceRecord>();
  for (const record of records) {
    const current = result.get(record.storeId);
    if (!current || record.purchasedAt > current.purchasedAt) result.set(record.storeId, record);
  }
  return [...result.values()];
}

function productPriceSummary(productID: string, catalog: PriceCatalog) {
  const records = catalog.records.filter((record) => record.productId === productID);
  if (!records.length) return { storeCount: 0, latestAt: "", range: "--" };
  const unit = records[0].normalizedUnit;
  const latest = latestByStore(records.filter((record) => record.normalizedUnit === unit));
  const prices = latest.map((record) => record.normalizedPrice);
  return {
    storeCount: new Set(records.map((record) => record.storeId)).size,
    latestAt: records[0].purchasedAt,
    range: `${formatMoney(Math.min(...prices))}—${formatMoney(Math.max(...prices))} 元/${normalizedLabels[unit]}`,
  };
}

function anomalyWarning(price: number, unit: NormalizedPriceUnit, history: PriceRecord[]) {
  if (history.length < 2) return "";
  const values = history.map((record) => record.normalizedPrice).sort((left, right) => left - right);
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  if (price > median * 5 || price < median / 5) return `换算后为 ${formatMoney(price)} 元/${normalizedLabels[unit]}，明显偏离历史中位价 ${formatMoney(median)} 元/${normalizedLabels[unit]}。`;
  return "";
}

function differenceFrom(value: number, reference: number, label: string, unit: NormalizedPriceUnit) {
  const difference = value - reference;
  if (Math.abs(difference) < 0.005) return `与${label}相同`;
  return `比${label}${difference > 0 ? "高" : "低"} ${formatMoney(Math.abs(difference))} 元/${normalizedLabels[unit]}`;
}

function entryDescription(record: PriceRecord) {
  const label = unitLabel(record.unit);
  if (record.entryMode === "unit_price") {
    const unitPrice = record.unitPrice ?? 0;
    return record.quantity ? `${formatMoney(unitPrice)} 元/${label} × ${formatQuantity(record.quantity)} ${label} · 合计 ${formatMoney(unitPrice * record.quantity)} 元` : `${formatMoney(unitPrice)} 元/${label} · 未记购买量`;
  }
  return `${formatMoney(record.totalPrice ?? 0)} 元 ÷ ${formatQuantity(record.quantity ?? 0)} ${label}`;
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 3 }).format(value);
}

function unitLabel(unit?: PriceUnit) {
  return unitOptions.find((item) => item.value === unit)?.label ?? unit ?? "";
}

function productIconKey(name: string) {
  if (/奶|酸奶|乳酪|芝士|黄油/.test(name)) return "dairy";
  if (/猪/.test(name)) return "pork";
  if (/牛肉|牛排|牛腩|牛里脊/.test(name)) return "beef";
  if (/牛|羊|肉|排骨|里脊|腊肉|香肠|火腿/.test(name)) return "meat";
  if (/面包|吐司|蛋糕|蛋挞|馒头|包子|糕点/.test(name)) return "bread";
  if (/蛋/.test(name)) return "egg";
  if (/鸡|鸭|鹅|鸽/.test(name)) return "poultry";
  if (/鱼|虾|蟹|贝|海鲜|鱿鱼/.test(name)) return "fish";
  if (/面条|挂面|粉丝|米线|河粉|方便面/.test(name)) return "noodle";
  if (/豆腐|豆干|腐竹|豆皮/.test(name)) return "tofu";
  if (/蘑菇|香菇|菌菇|木耳/.test(name)) return "mushroom";
  if (/番茄|西红柿/.test(name)) return "tomato";
  if (/菜|瓜|豆|笋|椒|葱|蒜|姜|番茄|土豆|萝卜|藕|芹|白菜|菠菜/.test(name)) return "vegetable";
  if (/果|苹果|梨|橙|柑|香蕉|桃|莓|葡萄|芒果|西瓜|柚/.test(name)) return "fruit";
  if (/大米|米饭|面粉|燕麦|小麦|玉米|杂粮|米$/.test(name)) return "grain";
  if (/水|饮料|果汁|茶|咖啡|酒|可乐/.test(name)) return "drink";
  if (/食用油|花生油|菜籽油|橄榄油|香油/.test(name)) return "oil";
  if (/盐|酱|醋|糖|调料|香料|味精|鸡精/.test(name)) return "condiment";
  if (/饼干|薯片|零食|巧克力|糖果|坚果/.test(name)) return "snack";
  if (/速冻|冷冻|雪糕|冰淇淋|冰棒/.test(name)) return "frozen";
  if (/纸巾|卷纸|洗衣|洗洁|清洁|垃圾袋|牙膏|香皂/.test(name)) return "household";
  return "fallback";
}

function storeBrandKey(name: string) {
  if (name.startsWith("永辉")) return "yonghui";
  if (name.startsWith("盒马")) return "hema";
  if (name.startsWith("条马") || name.startsWith("条码")) return "tiaoma";
  if (name.startsWith("新世纪") || name.startsWith("重百新世纪")) return "xinshiji";
  if (/菜市场|农贸市场/.test(name)) return "market";
  if (/路边摊|流动摊|摊位/.test(name)) return "stall";
  if (name.startsWith("客百年")) return "kebainian";
  if (name.startsWith("钱大妈")) return "qiandama";
  return "store";
}

function sameName(left: string, right: string) {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

function isOlder(value: string) {
  return Date.now() - new Date(value).getTime() > 30 * 86_400_000;
}

function relativeDate(value: string) {
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  if (days <= 0) return "今天记录";
  if (days === 1) return "昨天记录";
  return `${days} 天前记录`;
}

function formatPurchaseDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatMoney(value: number) {
  return Number(value.toFixed(2)).toString();
}

function toLocalInput(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function messageOf(reason: unknown) {
  return reason instanceof APIError || reason instanceof Error ? reason.message : "菜价操作失败，请稍后重试";
}
