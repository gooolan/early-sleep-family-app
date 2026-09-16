import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ProductIcon } from "./PriceView";
import { productLineIconAsset } from "./productLineIconAssets";
import "./styles.css";
import "./theme.css";
import "./iconPreview.css";

const groups = [
  { name: "蔬菜", items: [["番茄", 3.5], ["土豆", 2.8], ["黄瓜", 3.2], ["胡萝卜", 2.5], ["西兰花", 5.8], ["四季豆", 6.5], ["豇豆", 5.2], ["生菜", 3.9], ["空心菜", 4.5], ["芹菜", 3.8]] },
  { name: "水果", items: [["脆桃", 6.8], ["阳光玫瑰", 12.8], ["苹果", 5.9], ["橙子", 4.8]] },
  { name: "肉蛋水产", items: [["鸡蛋", 5.6], ["鸡胸肉", 9.9], ["前腿肉", 13.8], ["猪里脊", 19.8], ["牛里脊肉", 39.9], ["鲈鱼", 18.8], ["鲜虾", 29.8]] },
  { name: "豆制品与菌菇", items: [["豆腐", 3], ["香菇", 8.8]] },
  { name: "粮油与其他", items: [["大米", 3.6], ["面条", 4.5], ["其他商品", 6]] },
] satisfies Array<{ name: string; items: Array<[string, number]> }>;

const stores = ["菜市场", "永辉超市", "盒马"];
const products = groups.flatMap((group) => group.items.map(([name, price], index) => ({
  id: `demo-${name}`, name, price, category: group.name, createdAt: "2026-09-16T09:00:00+08:00",
  store: stores[index % stores.length], discount: index % 4 === 0,
})));
const iconCount = new Set(products.map((product) => productLineIconAsset(product.name).source)).size;

function IconPreview() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [size, setSize] = useState("大号");
  const [selectedID, setSelectedID] = useState<string | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selectedID) detailRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedID]);
  const selected = products.find((product) => product.id === selectedID);
  const visible = products.filter((product) => (category === "全部" || product.category === category) && product.name.includes(query.trim()));

  return <main className="icon-preview">
    <header className="icon-preview-header">
      <span className="icon-preview-badge">菜价预览 · 示例数据</span>
      <h1>逛一逛我们的菜篮子</h1>
      <p>{products.length} 种示例商品，完整展示当前 {iconCount} 款菜品图标。价格为虚构数据。</p>
    </header>
    <section className="icon-preview-controls" aria-label="预览设置">
      <label className="icon-preview-search">找一种菜<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索菜名，例如四季豆、猪里脊" /></label>
      <div className="icon-preview-sizes"><span>图标大小</span><div>{["小号", "标准", "大号"].map((value) => <button key={value} aria-pressed={size === value} onClick={() => setSize(value)}>{value}</button>)}</div></div>
      <nav className="icon-preview-filters" aria-label="商品分类">{["全部", ...groups.map((group) => group.name)].map((value) => <button key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>{value}</button>)}</nav>
    </section>
    <div className="icon-preview-result" role="status">正在展示 {visible.length} 种商品<span>点击商品，对照三种尺寸</span></div>
    {selected && <section ref={detailRef} className="icon-preview-detail" aria-label={`${selected.name}尺寸对照`}>
      <div><h2>{selected.name}</h2><p>小号用于快捷选择，标准用于列表，大号用于详情。</p></div>
      <button className="icon-preview-close" onClick={() => setSelectedID(null)} aria-label="关闭尺寸对照">×</button>
      <div className="icon-preview-comparison">{["小号", "标准", "大号"].map((value) => <div key={value}><ProductIcon product={selected} compact={value === "小号"} large={value === "大号"} /><span>{value}</span></div>)}</div>
    </section>}
    {groups.map((group) => {
      const items = visible.filter((product) => product.category === group.name);
      return items.length > 0 && <section key={group.name} className="icon-preview-group" aria-label={group.name}>
        <div className="icon-preview-group-title"><h2>{group.name}</h2><span>{items.length} 种</span></div>
        <div className="icon-preview-grid">{items.map((product) => <button key={product.id} className="icon-preview-product" aria-pressed={selectedID === product.id} onClick={() => setSelectedID(product.id)}>
          <ProductIcon product={product} compact={size === "小号"} large={size === "大号"} />
          <span className="icon-preview-product-copy"><b>{product.name}</b><small>{product.store} · 今天</small></span>
          <span className="icon-preview-price"><strong>¥{product.price.toFixed(2)}</strong><small>/斤</small>{product.discount && <em>优惠价</em>}</span>
        </button>)}</div>
      </section>;
    })}
    {visible.length === 0 && <p className="icon-preview-empty">没有找到这道菜，换个名称试试。</p>}
    <footer className="icon-preview-footer">叶菜、豆类和肉类的部分品种共用大类图标。此页仅供预览，不保存购买记录。<a href="/third-party-notices/product-icons.txt" target="_blank" rel="noreferrer">图标来源</a></footer>
  </main>;
}

createRoot(document.getElementById("root")!).render(<IconPreview />);
