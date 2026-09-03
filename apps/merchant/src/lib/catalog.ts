import type { CheckoutQuote, MerchantManifest, Product } from "@mandate/types";

export const MERCHANT_ID = "mandate-market";
export const merchantManifest: MerchantManifest = {
  name: "Mandate Market", merchantId: MERCHANT_ID, version: "1.3", currency: "INR",
  capabilities: { catalog: true, productLookup: true, inventory: true, checkoutPreview: true, agentCheckout: true, revenueRecommendations: true, growthOpportunities: true, payment: "razorpay" },
  endpoints: { catalog: "/api/agent/catalog", product: "/api/agent/products/:id", inventory: "/api/agent/inventory/:id", checkoutPreview: "/api/agent/checkout/preview", revenueRecommendations: "/api/agent/recommendations?productId=:id&maxSpendPaise=:limit", growthOpportunities: "/api/agent/growth-opportunities?productId=:id&maxSpendPaise=:limit" },
};

export const catalog: Product[] = [
  { id:"hp-001",sku:"MM-HP-001",name:"SoundMax Pro",slug:"soundmax-pro",category:"headphones",pricePaise:399900,currency:"INR",rating:4.6,reviewCount:1842,inventory:14,shortDescription:"Wireless ANC headphones with 40-hour battery life.",description:"Premium over-ear wireless headphones built for long listening sessions, travel and focused work.",features:["Active noise cancellation","40-hour battery","Multipoint Bluetooth","Fast USB-C charging"],specifications:{anc:"true",batteryHours:"40",connectivity:"Bluetooth 5.4",weight:"248g",microphone:"dual beamforming"},tags:["anc","wireless","travel","premium"] },
  { id:"hp-002",sku:"MM-HP-002",name:"Quietline 700",slug:"quietline-700",category:"headphones",pricePaise:289900,currency:"INR",rating:4.4,reviewCount:1118,inventory:22,shortDescription:"Lightweight ANC headphones tuned for everyday commuting.",description:"A lighter daily-driver headset with strong ANC and balanced sound.",features:["Active noise cancellation","32-hour battery","Low-latency mode"],specifications:{anc:"true",batteryHours:"32",connectivity:"Bluetooth 5.3",weight:"214g",microphone:"dual microphone"},tags:["anc","wireless","commute"] },
  { id:"hp-003",sku:"MM-HP-003",name:"Studio Air X",slug:"studio-air-x",category:"headphones",pricePaise:479900,currency:"INR",rating:4.8,reviewCount:863,inventory:7,shortDescription:"Studio-focused wireless headphones with adaptive ANC.",description:"High-fidelity wireless headphones with adaptive noise control and a studio tilt.",features:["Adaptive ANC","50-hour battery","Hi-res wireless","USB-C audio"],specifications:{anc:"true",batteryHours:"50",connectivity:"Bluetooth 5.4",weight:"271g",microphone:"triple array"},tags:["anc","wireless","studio","premium"] },
  { id:"kb-001",sku:"MM-KB-001",name:"Keycraft TKL",slug:"keycraft-tkl",category:"keyboards",pricePaise:349900,currency:"INR",rating:4.7,reviewCount:672,inventory:18,shortDescription:"Compact mechanical keyboard with hot-swap switches.",description:"A clean tenkeyless board with hot-swap switches and quiet stabilizers.",features:["Hot-swap switches","TKL layout","Per-key backlight"],specifications:{switches:"linear",layout:"TKL",connectivity:"USB-C + 2.4GHz"},tags:["mechanical","keyboard","tkl"] },
  { id:"ms-001",sku:"MM-MS-001",name:"Arc Precision Mouse",slug:"arc-precision-mouse",category:"mice",pricePaise:249900,currency:"INR",rating:4.5,reviewCount:928,inventory:31,shortDescription:"Ergonomic wireless mouse with an accurate 26K sensor.",description:"A balanced productivity and gaming mouse with a high-resolution optical sensor.",features:["26K sensor","Ergonomic shape","70-hour battery"],specifications:{sensor:"26,000 DPI",batteryHours:"70",connectivity:"2.4GHz + Bluetooth"},tags:["mouse","wireless","ergonomic"] },
  { id:"wm-001",sku:"MM-WM-001",name:"Viewline 27Q",slug:"viewline-27q",category:"monitors",pricePaise:2199900,currency:"INR",rating:4.7,reviewCount:404,inventory:5,shortDescription:"27-inch QHD monitor with a 165Hz refresh rate.",description:"A sharp QHD productivity and gaming display with USB-C connectivity.",features:["27-inch QHD","165Hz","USB-C 90W"],specifications:{resolution:"2560x1440",refreshRate:"165Hz",panel:"IPS",size:"27-inch"},tags:["monitor","qhd","gaming","usb-c"] },
  { id:"wc-001",sku:"MM-WC-001",name:"FrameCam 4K",slug:"framecam-4k",category:"webcams",pricePaise:599900,currency:"INR",rating:4.6,reviewCount:318,inventory:11,shortDescription:"4K webcam with HDR and beamforming microphones.",description:"A compact camera for calls, streaming and creator setups.",features:["4K HDR","Beamforming microphones","Auto framing"],specifications:{resolution:"4K",framerate:"30fps",focus:"autofocus",fieldOfView:"90°"},tags:["webcam","4k","video"] },
  { id:"sw-001",sku:"MM-SW-001",name:"Pulse One",slug:"pulse-one",category:"smartwatches",pricePaise:449900,currency:"INR",rating:4.5,reviewCount:711,inventory:9,shortDescription:"AMOLED smartwatch with GPS and seven-day battery life.",description:"A straightforward everyday smartwatch with bright AMOLED display and multi-day battery.",features:["AMOLED display","GPS","7-day battery","Water resistant"],specifications:{display:"1.5-inch AMOLED",batteryDays:"7",gps:"dual-band",waterResistance:"5ATM"},tags:["watch","fitness","gps"] },
];

const quotes = new Map<string, CheckoutQuote>();
export function findProduct(productId:string):Product|undefined{return catalog.find(p=>p.id===productId)};
export function buildQuote(product:Product,quantity:number):CheckoutQuote{return buildMultiLineQuote([{productId:product.id,quantity}])}
export function buildMultiLineQuote(items:Array<{productId:string;quantity:number}>):CheckoutQuote{
  const normalized=new Map<string,number>();
  for(const item of items) normalized.set(item.productId,(normalized.get(item.productId)??0)+item.quantity);
  const lineItems=[...normalized.entries()].map(([productId,quantity])=>{const product=findProduct(productId);if(!product)throw new Error("PRODUCT_NOT_FOUND");if(product.inventory<quantity)throw new Error("INSUFFICIENT_INVENTORY");return {productId,quantity,unitPricePaise:product.pricePaise,lineTotalPaise:product.pricePaise*quantity}});
  const subtotalPaise=lineItems.reduce((sum,item)=>sum+item.lineTotalPaise,0);
  const shippingPaise=subtotalPaise>=300000?0:9900;
  const taxPaise=Math.round(subtotalPaise*0.18);
  const discountPaise=subtotalPaise>=500000?25000:0;
  const quote:CheckoutQuote={quoteId:`quote_${crypto.randomUUID().replaceAll("-","").slice(0,16)}`,merchantId:MERCHANT_ID,lineItems,subtotalPaise,shippingPaise,taxPaise,discountPaise,totalPaise:subtotalPaise+shippingPaise+taxPaise-discountPaise,currency:"INR",expiresAt:new Date(Date.now()+5*60*1000).toISOString()};
  quotes.set(quote.quoteId,quote);return quote;
}
export function getQuote(quoteId:string):CheckoutQuote|undefined{return quotes.get(quoteId)}
