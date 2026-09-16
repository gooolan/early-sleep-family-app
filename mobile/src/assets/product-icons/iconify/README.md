# 菜价图标来源

通过 better-icons 检索，SVG 保存在项目内；运行时不依赖远程图标服务。

| 文件 | 图标 ID | 作者 | 许可证 |
| --- | --- | --- | --- |
| broccoli.svg | `lucide:broccoli` | Lucide Contributors | [ISC](https://github.com/lucide-icons/lucide/blob/main/LICENSE) |
| carrot.svg | `lucide:carrot` | Lucide Contributors | [ISC](https://github.com/lucide-icons/lucide/blob/main/LICENSE) |
| greens.svg | `lucide:leafy-green` | Lucide Contributors | [ISC](https://github.com/lucide-icons/lucide/blob/main/LICENSE) |
| grapes.svg | `lucide-lab:grapes` | Lucide Contributors | [ISC](https://github.com/lucide-icons/lucide-lab/blob/main/LICENSE) |
| peach.svg | `lucide-lab:peach` | Lucide Contributors | [ISC](https://github.com/lucide-icons/lucide-lab/blob/main/LICENSE) |
| apple.svg | `lucide:apple` | Lucide Contributors | [ISC](https://github.com/lucide-icons/lucide/blob/main/LICENSE) |
| egg.svg | `lucide:egg` | Lucide Contributors | [ISC](https://github.com/lucide-icons/lucide/blob/main/LICENSE) |
| chicken.svg | `lucide:drumstick` | Lucide Contributors | [ISC](https://github.com/lucide-icons/lucide/blob/main/LICENSE) |
| pork.svg | `hugeicons:steak` | Hugeicons | [MIT](https://github.com/hugeicons/hugeicons-react/blob/main/LICENSE.md) |
| beef.svg | `lucide:beef` | Lucide Contributors | [ISC](https://github.com/lucide-icons/lucide/blob/main/LICENSE) |
| basket.svg | `lucide:shopping-basket` | Lucide Contributors | [ISC](https://github.com/lucide-icons/lucide/blob/main/LICENSE) |
| tomato.svg | `tdesign:tomato` | TDesign | [MIT](https://github.com/Tencent/tdesign-icons/blob/main/LICENSE) |
| cucumber.svg | `tdesign:cucumber` | TDesign | [MIT](https://github.com/Tencent/tdesign-icons/blob/main/LICENSE) |
| beans.svg | `icon-park-outline:peas` | ByteDance | [Apache 2.0](https://github.com/bytedance/IconPark/blob/master/LICENSE) |
| potato.svg | `openmoji:potato` | OpenMoji | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| noodles.svg | `hugeicons:noodles` | Hugeicons | [MIT](https://github.com/hugeicons/hugeicons-react/blob/main/LICENSE.md) |

原始许可证保存在 `licenses/`。Iconify 原始地址格式为 `https://api.iconify.design/{prefix}/{name}.svg`。

土豆采用 [OpenMoji 官方黑白版](https://github.com/hfg-gmuend/openmoji/blob/master/black/svg/1F954.svg)，由 OpenMoji 提供，采用 CC BY-SA 4.0；本项目将 72px 画布中的线宽从 2 调整为 5，以匹配其他图标。修改后的土豆 SVG 继续采用 CC BY-SA 4.0。

其他图标保留原始几何和线条，通过页面现有 CSS 蒙版应用分类颜色。better-icons CLI 的输出会给部分线条路径插入填色，因此最终文件从其使用的 Iconify API 直接获取。

叶菜（空心菜、生菜、芹菜）和肉类细分品种缺少准确的同风格素材时沿用大类图形；四季豆、豇豆等采用豆荚类图形，名称仍是品种的准确标识。
