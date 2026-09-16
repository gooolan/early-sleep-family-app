import broccoli from "./assets/product-icons/broccoli.png";
import carrot from "./assets/product-icons/carrot.png";
import celery from "./assets/product-icons/celery.png";
import chickenBreast from "./assets/product-icons/chicken-breast.png";
import greenBean from "./assets/product-icons/green-bean.png";
import lettuce from "./assets/product-icons/lettuce.png";
import peach from "./assets/product-icons/peach.png";
import porkFrontLeg from "./assets/product-icons/pork-front-leg.png";
import porkTenderloin from "./assets/product-icons/pork-tenderloin.png";
import shineMuscat from "./assets/product-icons/shine-muscat.png";
import waterSpinach from "./assets/product-icons/water-spinach.png";
import yardlongBean from "./assets/product-icons/yardlong-bean.png";

const productPhotos: Array<{ names: RegExp; source: string }> = [
  { names: /鸡胸肉|鸡胸/, source: chickenBreast },
  { names: /前腿肉|猪前腿/, source: porkFrontLeg },
  { names: /里脊肉|猪里脊/, source: porkTenderloin },
  { names: /阳光玫瑰|晴王/, source: shineMuscat },
  { names: /脆桃|水蜜桃|桃$/, source: peach },
  { names: /胡萝卜|红萝卜/, source: carrot },
  { names: /西兰花|绿花椰菜/, source: broccoli },
  { names: /空心菜|蕹菜/, source: waterSpinach },
  { names: /四季豆|菜豆/, source: greenBean },
  { names: /豇豆|豆角/, source: yardlongBean },
  { names: /生菜/, source: lettuce },
  { names: /芹菜/, source: celery },
];

export function productPhotoSource(name: string) {
  const normalized = name.trim();
  return productPhotos.find((item) => item.names.test(normalized))?.source;
}
