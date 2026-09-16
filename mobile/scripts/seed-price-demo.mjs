// Creates an independent local demo family; never accepts a remote backend.
import assert from 'node:assert/strict';
const backend = process.env.DEMO_API_URL || 'http://127.0.0.1:18080';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(backend).hostname), 'Demo seeding requires a local backend');
const ownerPhone = '19900000001';
const partnerPhone = '19900000002';
async function request(path, body, token, method = 'POST') {
  const response = await fetch(`${backend}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: ${JSON.stringify(result)}`);
  return result.data;
}
const identity = await request('/api/v1/identity/check', { phone: ownerPhone });
const owner = identity.exists
  ? await request('/api/v1/sessions', { phone: ownerPhone })
  : await request('/api/v1/families', { phone: ownerPhone, familyName: '菜价体验家庭（本地假数据）', nickname: '小兰', timezone: 'Asia/Shanghai' });
assert.equal(owner.family.name, '菜价体验家庭（本地假数据）', 'Only the designated demo family may be seeded');
const partnerIdentity = await request('/api/v1/identity/check', { phone: partnerPhone });
const partner = partnerIdentity.exists
  ? await request('/api/v1/sessions', { phone: partnerPhone })
  : await request('/api/v1/families/join', { phone: partnerPhone, nickname: '阿辰', joinCode: owner.joinCode });
assert.equal(partner.family.id, owner.family.id);
let catalog = await request('/api/v1/prices', undefined, owner.token, 'GET');
const stores = [
  ['永辉超市·万达店', 'yonghui'], ['盒马鲜生·万象城店', 'hema'],
  ['条马鲜生·社区店', 'tiaoma'], ['幸福菜市场', 'market'], ['永辉超市·社区店', 'yonghui'],
];
for (const [name, brandKey] of stores) {
  if (!catalog.stores.some(store => store.name === name)) catalog = await request('/api/v1/price-stores', { name, brandKey }, owner.token);
}
const products = [
  ['西红柿', 3.8, 'jin', 'tomato'], ['西兰花', 5.5, 'jin', 'broccoli'],
  ['胡萝卜', 2.6, 'jin', 'carrot'], ['黄瓜', 3.2, 'jin', 'cucumber'],
  ['土豆', 2.3, 'jin', 'potato'], ['青菜', 2.9, 'jin', 'greens'],
  ['猪里脊', 19.8, 'jin', 'pork'], ['鸡胸肉', 11.8, 'jin', 'chicken'],
  ['牛肉', 38.8, 'jin', 'beef'], ['鸡蛋', 0.85, 'piece', 'egg'],
  ['苹果', 5.9, 'jin', 'apple'], ['葡萄', 9.9, 'jin', 'grapes'],
  ['桃子', 6.8, 'jin', 'peach'], ['牛奶', 12.5, 'liter', 'basket'],
  ['豆腐', 3.5, 'box', 'beans'], ['空心菜', 3.4, 'jin', 'greens'],
];
for (const [name, , , iconKey] of products) {
  if (!catalog.products.some(product => product.name === name)) catalog = await request('/api/v1/price-products', { name, iconKey }, owner.token);
}
const now = new Date();
const money = value => Math.round(value * 100) / 100;
let added = 0;
for (const [index, [name, base, normalizedUnit]] of products.entries()) {
  const product = catalog.products.find(item => item.name === name);
  const storeCount = index < 4 ? 5 : 3;
  for (let shop = 0; shop < storeCount; shop++) {
    const store = catalog.stores.find(item => item.name === stores[shop][0]);
    for (const [week, age] of [24, 16, 9, 2].entries()) {
      // Leave one older store quote to exercise stale-price labels.
      if (name === '西红柿' && shop === 4 && week > 1) continue;
      const purchased = new Date(now.getTime() - (age + index % 3) * 86_400_000 - shop * 3_600_000);
      purchased.setMinutes(15, 0, 0);
      const purchasedAt = purchased.toISOString();
      if (catalog.records.some(record => record.productId === product.id && record.storeId === store.id && record.purchasedAt.slice(0, 10) === purchasedAt.slice(0, 10))) continue;
      const discount = (index + shop + week) % 5 === 0;
      const price = money(base * [1, 1.18, .89, .83, 1.05][shop] * [1.16, 1.06, 1.1, 1][week] * (discount ? .83 : 1));
      const totalMode = (index + shop + week) % 3 === 0;
      const grams = normalizedUnit === 'jin' && totalMode;
      const unit = grams ? 'gram' : normalizedUnit;
      const quantity = grams ? 650 + (index % 4) * 100 : normalizedUnit === 'piece' ? 10 : 1;
      const totalPrice = money(price * (grams ? quantity / 500 : quantity));
      const record = {
        productId: product.id, storeId: store.id, purchasedAt,
        entryMode: totalMode ? 'total_price' : 'unit_price', unit,
        ...(totalMode ? { totalPrice, quantity } : { unitPrice: price, quantity: normalizedUnit === 'piece' ? 10 : 1 }),
        priceKind: discount ? 'discount' : 'regular',
        ...(discount ? { referencePrice: money(price * 1.25), referenceUnit: normalizedUnit } : {}),
        ...((index + shop) % 4 === 0 ? {} : { quality: 3 + (index + shop + week) % 3 }),
      };
      catalog = await request('/api/v1/price-records', record, (index + shop) % 2 ? partner.token : owner.token);
      added++;
    }
  }
}
console.log(JSON.stringify({ backend, family: owner.family.name, loginPhone: ownerPhone, products: catalog.products.length, stores: catalog.stores.length, records: catalog.records.length, added }, null, 2));
