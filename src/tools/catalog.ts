import { DimensionTool, HatchTool, TextTool } from './annotateTools';
import { ArcTool, CircleTool, SplineTool } from './curveTools';
import { EraseTool, LineTool, PathTool, PendingTool, PointTool, RectangleTool } from './drawTools';
import { ChamferTool, FilletTool } from './cornerTools';
import { ExtendTool, OffsetTool, TrimTool } from './edgeTools';
import { BreakTool, DivideTool, VertexTool } from './pathEditTools';
import { ExplodeTool, JoinTool, StretchTool } from './editTools';
import { ArrayTool, MirrorTool, MoveTool, RotateTool, ScaleTool } from './modifyTools';
import { PanTool, SelectTool, ZoomWindowTool } from './SelectTool';
import type { ToolDescriptor } from './Tool';

/** Layers the map tools write to (project template; new layers otherwise). */
const LAYERS = { parcel: 'parsel', spot: 'kot' };

type Def = Omit<ToolDescriptor, 'create' | 'ready'> & Partial<Pick<ToolDescriptor, 'create'>>;

/**
 * Every tool in one declarative list. Toolbox, menus, shortcuts and the
 * command line are all generated from this — add a tool here and it shows
 * up everywhere.
 */
const defs: Def[] = [
  // Seçim ve görünüm
  { id: 'select', label: 'Seç', icon: 'select', group: 'select', shortcut: 'Esc', aliases: ['SEC', 'SELECT'], description: 'Nesne seçer. Sürükleyerek pencere ya da kesişim seçimi yapın.', create: (c) => new SelectTool(c) },
  { id: 'pan', label: 'Kaydır', icon: 'pan', group: 'select', shortcut: 'Shift+H', aliases: ['PAN', 'KAYDIR'], description: 'Görünümü sürükler. Orta tuşla her araçta kullanılabilir.', create: (c) => new PanTool(c) },
  { id: 'zoomWindow', label: 'Pencere yakınlaştır', icon: 'zoomWindow', group: 'select', shortcut: 'Z', aliases: ['Z', 'ZOOM', 'PENCERE'], description: 'Çizilen dikdörtgene yakınlaştırır.', create: (c) => new ZoomWindowTool(c) },

  // Çizim
  { id: 'point', label: 'Nokta', icon: 'point', group: 'draw', shortcut: 'N', aliases: ['PO', 'POINT', 'NOKTA'], description: 'Tek tek nokta yerleştirir.', create: (c) => new PointTool(c, { id: 'point', label: 'Nokta', askZ: false }) },
  { id: 'divide', label: 'Böl', icon: 'divide', group: 'draw', shortcut: 'Shift+D', aliases: ['DIV', 'DIVIDE', 'ME', 'MEASURE', 'BOL'], description: 'Nesne boyunca nokta koyar: eşit parçalara ya da A ile verilen aralıkla.', create: (c) => new DivideTool(c) },
  { id: 'line', label: 'Çizgi', icon: 'line', group: 'draw', shortcut: 'L', aliases: ['L', 'LINE', 'CIZGI'], description: 'Uç uca bağlı çizgi parçaları çizer.', create: (c) => new LineTool(c) },
  { id: 'polyline', label: 'Çoklu çizgi', icon: 'polyline', group: 'draw', shortcut: 'P', aliases: ['PL', 'PLINE', 'COKLUCIZGI'], description: 'Tek parça, açık çoklu çizgi çizer; Y ile teğet yay parçası, D ile düz parça.', create: (c) => new PathTool(c, { id: 'polyline', label: 'Çoklu çizgi', closed: false }) },
  { id: 'arc', label: 'Yay', icon: 'arc', group: 'draw', shortcut: 'A', aliases: ['A', 'ARC', 'YAY'], description: 'Başlangıç, ara ve bitiş noktasından geçen yay çizer; M ile merkez, başlangıç ve açıdan.', create: (c) => new ArcTool(c) },
  { id: 'circle', label: 'Daire', icon: 'circle', group: 'draw', shortcut: 'C', aliases: ['C', 'CIRCLE', 'DAIRE'], description: 'Merkez ve yarıçapla daire çizer; 2N çaptan, 3N üç noktadan, TTY iki nesneye teğet.', create: (c) => new CircleTool(c) },
  { id: 'rectangle', label: 'Dikdörtgen', icon: 'rectangle', group: 'draw', shortcut: 'R', aliases: ['REC', 'RECTANGLE', 'DIKDORTGEN'], description: 'İki köşe noktasından dikdörtgen çizer.', create: (c) => new RectangleTool(c) },
  { id: 'polygon', label: 'Kapalı alan', icon: 'polygon', group: 'draw', shortcut: 'G', aliases: ['KA', 'ALAN', 'POLYGON'], description: 'Kapalı çoklu çizgi (alan) çizer.', create: (c) => new PathTool(c, { id: 'polygon', label: 'Kapalı alan', closed: true }) },
  { id: 'spline', label: 'Eğri', icon: 'spline', group: 'draw', shortcut: 'S', aliases: ['SPL', 'SPLINE', 'EGRI'], description: 'Tıklanan noktalardan geçen yumuşak eğri çizer; K ile kapatır.', create: (c) => new SplineTool(c) },

  // Açıklama
  { id: 'text', label: 'Yazı', icon: 'text', group: 'annotate', shortcut: 'T', aliases: ['T', 'TEXT', 'YAZI'], description: 'Tek satır yazı ekler: konum, açı, metin. Yükseklik kâğıt mm olarak verilir. Yazıya çift tıklayarak düzenleyin.', create: (c) => new TextTool(c) },
  { id: 'dimension', label: 'Ölçülendirme', icon: 'dimension', group: 'annotate', shortcut: 'D', aliases: ['DIM', 'OLCU'], description: 'İki nokta arasına hizalı ölçü ekler; değer proje birimini izler.', create: (c) => new DimensionTool(c) },
  { id: 'hatch', label: 'Tarama', icon: 'hatch', group: 'annotate', shortcut: 'H', aliases: ['H', 'HATCH', 'TARAMA'], description: 'Tıklanan kapalı alanı desenle tarar; D ile desen değişir.', create: (c) => new HatchTool(c) },

  // Değiştir
  { id: 'move', label: 'Taşı', icon: 'move', group: 'modify', shortcut: 'Shift+M', aliases: ['M', 'MOVE', 'TASI'], description: 'Seçili nesneleri temel noktadan hedefe taşır.', create: (c) => new MoveTool(c, { id: 'move', label: 'Taşı', copy: false }) },
  { id: 'copy', label: 'Kopyala', icon: 'copy', group: 'modify', shortcut: 'Shift+C', aliases: ['CO', 'COPY', 'KOPYALA'], description: 'Seçili nesnelerin bir ya da daha fazla kopyasını çıkarır.', create: (c) => new MoveTool(c, { id: 'copy', label: 'Kopyala', copy: true }) },
  { id: 'rotate', label: 'Döndür', icon: 'rotate', group: 'modify', shortcut: 'Shift+R', aliases: ['RO', 'ROTATE', 'DONDUR'], description: 'Seçili nesneleri bir nokta etrafında döndürür. Açı yazılabilir; K ile kopya.', create: (c) => new RotateTool(c) },
  { id: 'scale', label: 'Ölçekle', icon: 'scale', group: 'modify', shortcut: 'Shift+S', aliases: ['SC', 'SCALE', 'OLCEKLE'], description: 'Seçili nesneleri temel noktaya göre büyütür ya da küçültür: faktör ya da referans uzunluk.', create: (c) => new ScaleTool(c) },
  { id: 'mirror', label: 'Aynala', icon: 'mirror', group: 'modify', shortcut: 'Shift+I', aliases: ['MI', 'MIRROR', 'AYNALA'], description: 'Seçili nesnelerin iki noktalı eksene göre simetriğini alır; S ile kaynağı siler.', create: (c) => new MirrorTool(c) },
  { id: 'offset', label: 'Ötele', icon: 'offset', group: 'modify', shortcut: 'Shift+O', aliases: ['O', 'OFFSET', 'OTELE'], description: 'Çizgi, çoklu çizgi, alan, daire ya da yayın paralel kopyasını çıkarır.', create: (c) => new OffsetTool(c) },
  { id: 'trim', label: 'Buda', icon: 'trim', group: 'modify', shortcut: 'Shift+T', aliases: ['TR', 'TRIM', 'BUDA'], description: 'Tıklanan parçayı, onu kesen en yakın iki kenar arasında siler.', create: (c) => new TrimTool(c) },
  { id: 'extend', label: 'Uzat', icon: 'extend', group: 'modify', shortcut: 'Shift+E', aliases: ['EX', 'EXTEND', 'UZAT'], description: 'Çizgi ya da yay ucunu ilk rastladığı kenara kadar uzatır.', create: (c) => new ExtendTool(c) },
  { id: 'fillet', label: 'Köşe yuvarla', icon: 'fillet', group: 'modify', shortcut: 'Shift+F', aliases: ['F', 'FILLET', 'YUVARLA'], description: 'İki çizgiyi ya da çoklu çizginin komşu iki kenarını yarıçaplı yayla (0: keskin köşe) birleştirir.', create: (c) => new FilletTool(c) },
  { id: 'chamfer', label: 'Pah', icon: 'chamfer', group: 'modify', shortcut: 'Shift+P', aliases: ['CHA', 'CHAMFER', 'PAH'], description: 'Köşeyi iki mesafeyle keser: iki çizgi ya da çoklu çizginin komşu kenarları (imar köşe kesmesi).', create: (c) => new ChamferTool(c) },
  { id: 'break', label: 'Kır', icon: 'break', group: 'modify', shortcut: 'B', aliases: ['BR', 'BREAK', 'KIR'], description: 'Nesnenin iki nokta arasındaki kısmını siler; Enter ile tek noktadan böler.', create: (c) => new BreakTool(c) },
  { id: 'join', label: 'Birleştir', icon: 'join', group: 'modify', shortcut: 'J', aliases: ['J', 'JOIN', 'BIRLESTIR'], description: 'Uç uca gelen çizgi, yay ve çoklu çizgileri tek çoklu çizgiye; kapanırsa kapalı alana çevirir.', create: (c) => new JoinTool(c) },
  { id: 'explode', label: 'Patlat', icon: 'explode', group: 'modify', shortcut: 'X', aliases: ['X', 'EXPLODE', 'PATLAT'], description: 'Çoklu çizgi ve alanı çizgi ve yaylara, eğriyi çoklu çizgiye, ölçüyü çizgi ve yazıya ayırır.', create: (c) => new ExplodeTool(c) },
  { id: 'stretch', label: 'Esnet', icon: 'stretch', group: 'modify', shortcut: 'E', aliases: ['STR', 'STRETCH', 'ESNET'], description: 'Pencerenin içinde kalan köşeleri taşır; dışındakiler yerinde kalır.', create: (c) => new StretchTool(c) },
  { id: 'vertex', label: 'Köşe ekle/sil', icon: 'vertex', group: 'modify', shortcut: 'V', aliases: ['KOSE', 'VERTEX'], description: 'Kenara tıklayınca köşe ekler, köşeye tıklayınca siler.', create: (c) => new VertexTool(c) },
  { id: 'array', label: 'Dizi', icon: 'array', group: 'modify', shortcut: 'Shift+A', aliases: ['AR', 'ARRAY', 'DIZI'], description: 'Seçili nesneleri satır ve sütun düzeninde çoğaltır.', create: (c) => new ArrayTool(c) },
  { id: 'erase', label: 'Sil', icon: 'erase', group: 'modify', shortcut: 'Delete', aliases: ['E', 'ERASE', 'SIL'], description: 'Seçili nesneleri siler; seçim yoksa tıklanan nesneyi siler.', create: (c) => new EraseTool(c) },

  // Harita
  { id: 'parcel', label: 'Parsel oluştur', icon: 'parcel', group: 'map', shortcut: 'Alt+P', aliases: ['PARSEL'], description: 'Köşe noktalarından parsel çizer, numara ve tapu alanını yazar.', create: (c) => new PathTool(c, { id: 'parcel', label: 'Parsel', closed: true, parcelLayer: LAYERS.parcel }) },
  { id: 'subdivide', label: 'İfraz', icon: 'subdivide', group: 'map', shortcut: 'Alt+I', aliases: ['IFRAZ'], description: 'Parseli verilen alan ya da doğrultuya göre böler.' },
  { id: 'stakeout', label: 'Aplikasyon', icon: 'stakeout', group: 'map', shortcut: 'Alt+A', aliases: ['APLIKASYON', 'APL'], description: 'Seçili noktalar için istasyondan semt ve mesafe hesaplar.' },
  { id: 'spot', label: 'Kot noktası', icon: 'spot', group: 'map', shortcut: 'Alt+Z', aliases: ['KOT'], description: 'Kot değeri girilerek yükseklik noktası ekler.', create: (c) => new PointTool(c, { id: 'spot', label: 'Kot noktası', askZ: true, layerId: LAYERS.spot }) },
  { id: 'measure', label: 'Mesafe ölç', icon: 'measure', group: 'map', shortcut: 'Alt+M', aliases: ['DI', 'DIST', 'MESAFE'], description: 'Noktalar arası kenar uzunluğu ve semt açısını ölçer.', create: (c) => new PathTool(c, { id: 'measure', label: 'Mesafe ölç', closed: false, measureOnly: true }) },
  { id: 'area', label: 'Alan hesapla', icon: 'area', group: 'map', shortcut: 'Alt+H', aliases: ['AA', 'AREA', 'ALANHESAP'], description: 'Tıklanan köşelerden alan ve çevre hesaplar.', create: (c) => new PathTool(c, { id: 'area', label: 'Alan hesapla', closed: true, measureOnly: true }) },
];

export const TOOL_CATALOG: ToolDescriptor[] = defs.map((d) => ({
  ...d,
  ready: !!d.create,
  create: d.create ?? (() => new PendingTool(d.id, d.label)),
}));
