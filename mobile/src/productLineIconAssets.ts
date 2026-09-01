import apple from "./assets/product-icons/line-selected-final/pingguo.svg";
import basket from "./assets/product-icons/line-selected-final/gouwulan.svg";
import beef from "./assets/product-icons/line-selected-final/yinshi_niurou_shiwu.svg";
import broccoli from "./assets/product-icons/line-selected-final/xilanhua.svg";
import carrot from "./assets/product-icons/line-selected-final/huluobushucaiqu.svg";
import chicken from "./assets/product-icons/line-selected-final/jirou.svg";
import egg from "./assets/product-icons/line-selected-final/danlei.svg";
import fish from "./assets/product-icons/line-selected-final/yu.svg";
import fruit from "./assets/product-icons/line-selected-final/shuiguo.svg";
import grapes from "./assets/product-icons/line-selected-final/putao.svg";
import greens from "./assets/product-icons/line-selected-final/qingcai.svg";
import mushroom from "./assets/product-icons/line-selected-final/mogu.svg";
import peach from "./assets/product-icons/line-selected-final/taozi.svg";
import pork from "./assets/product-icons/line-selected-final/zhurou.svg";
import seafood from "./assets/product-icons/line-selected-final/haixian.svg";
import staple from "./assets/product-icons/line-selected-final/mimianliangyou.svg";
import tofu from "./assets/product-icons/line-selected-final/peicai-doufu.svg";

export type ProductLineTone = "beef" | "carrot" | "egg" | "fallback" | "fish" | "fruit" | "grape" | "greens" | "mushroom" | "pork" | "poultry" | "seafood" | "staple" | "tofu";

export type ProductLineIconAsset = {
  source: string;
  tone: ProductLineTone;
};

const productLineIcons: Array<{ names: RegExp; asset: ProductLineIconAsset }> = [
  { names: /胡萝卜|红萝卜/, asset: { source: carrot, tone: "carrot" } },
  { names: /西兰花|绿花椰菜/, asset: { source: broccoli, tone: "greens" } },
  { names: /脆桃|水蜜桃|桃$/, asset: { source: peach, tone: "fruit" } },
  { names: /阳光玫瑰|晴王|葡萄|提子/, asset: { source: grapes, tone: "grape" } },
  { names: /苹果/, asset: { source: apple, tone: "fruit" } },
  { names: /鸡蛋|鸭蛋|鹅蛋|鹌鹑蛋|蛋$/, asset: { source: egg, tone: "egg" } },
  { names: /鸡胸|鸡肉|鸡腿|鸡翅|鸭肉|鹅肉|禽肉/, asset: { source: chicken, tone: "poultry" } },
  { names: /前腿肉|里脊肉|猪肉|排骨|腊肉|香肠|火腿/, asset: { source: pork, tone: "pork" } },
  { names: /牛肉|牛排|牛腩|牛里脊|羊肉|羊排/, asset: { source: beef, tone: "beef" } },
  { names: /豆腐|豆干|腐竹|豆皮/, asset: { source: tofu, tone: "tofu" } },
  { names: /蘑菇|香菇|菌菇|木耳/, asset: { source: mushroom, tone: "mushroom" } },
  { names: /虾|蟹|贝|海鲜|鱿鱼/, asset: { source: seafood, tone: "seafood" } },
  { names: /鱼/, asset: { source: fish, tone: "fish" } },
  { names: /番茄|西红柿|梨|橙|柑|香蕉|莓|芒果|西瓜|柚|水果/, asset: { source: fruit, tone: "fruit" } },
  { names: /大米|米饭|面粉|燕麦|小麦|玉米|杂粮|面条|挂面|粉丝|米线|河粉|食用油|花生油|菜籽油|橄榄油|香油/, asset: { source: staple, tone: "staple" } },
  { names: /菜|瓜|豆|笋|椒|葱|蒜|姜|土豆|萝卜|藕|芹|白菜|菠菜|花菜|菜花|芦笋/, asset: { source: greens, tone: "greens" } },
  { names: /肉/, asset: { source: beef, tone: "beef" } },
];

const fallbackAsset: ProductLineIconAsset = { source: basket, tone: "fallback" };

export function productLineIconAsset(name: string) {
  const normalized = name.trim();
  return productLineIcons.find((item) => item.names.test(normalized))?.asset ?? fallbackAsset;
}
