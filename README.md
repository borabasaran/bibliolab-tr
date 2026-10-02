# BiblioLab TR

Tarayıcıda çalışan, sunucusuz bibliyometrik analiz platformu: OpenAlex, TR Dizin, DergiPark ve Scopus/WoS verileriyle çalışır, üstüne Google Gemini destekli yorumlama katmanı ekler.

**Adres:** [bibliolab.bbasaran.net](https://bibliolab.bbasaran.net)

Hiçbir veri veya API anahtarı bir sunucuya gönderilmez. Korpus ve anahtar yalnızca kullanıcının kendi tarayıcısında tutulur; LLM istekleri doğrudan Google'a gider.

## Arayüz

Uygulama altı sekmeden oluşur:

1. **Veri Kaynağı:** Üstte korpus şeridi (kayıt sayısı, kaynak dağılımı, bulanık mükerrer taraması, temizleme, "Analize geç"). Altında üç kaynak bölmesi: OpenAlex, Dosya yükle (TR Dizin JSON yapıştırma dahil), DergiPark. Seyrek kullanılan alanlar "Gelişmiş ayarlar" altındadır. Veri yüklenince veri sağlığı raporu görünür.
2. **Analiz:** Özet kartları ve dört grup: Genel görünüm, Yazar ve kurum, Dergi ve kaynak, İçerik ve temalar.
3. **Ağlar:** Anahtar kelime, ortak yazarlık, bibliyografik eşleşme ve ortak atıf ağları.
4. **LLM Yorumu:** Tek satırlık anahtar şeridi ve üç bölme: Hazır görevler, Tematik sınıflandırma, Korpusla sohbet.
5. **Doğrulama:** Altın Standart veri setiyle karşılaştırma.
6. **Dışa Aktar:** CSV ve JSON çıktıları.

## Özellikler

- **Veri kaynakları:** OpenAlex API (ISSN, arama terimi ve yıl filtreli, "yalnızca makale" seçenekli, kaynakça verisiyle sayfalı çekim; yalnızca gerekli alanlar indirilir), Scopus `.csv`, Scopus/WoS `.bib`, OpenAlex `.json`/`.csv`, TR Dizin arama servisi JSON çıktısı, DergiPark OAI-PMH hasadı (Dublin Core), bursiyer/manuel veri tablosu `.xlsx`/`.csv` (baslik, yazarlar, yil, dergi, tur, anahtar_kelimeler, ozet, kurum, doi, tema sütunları).
- **Kalıcı korpus:** Korpus, tema etiketleri dahil, tarayıcıda (IndexedDB) saklanır ve sayfa yeniden açıldığında otomatik geri yüklenir. "Korpusu temizle" saklanan kopyayı da siler. Tarayıcı depolamayı engellerse (ör. gizli pencere) uygulama yine çalışır, yalnızca korpus kalıcı olmaz.
- **Veri sağlığı:** Alan doluluk oranları (başlık, yazar, yıl, özet, DOI vb.) ve karakter kodlama sorunu taraması; %70 altındaki alanlar işaretlenir.
- **Mükerrer temizleme:** Birebir DOI/başlık ayıklamaya ek olarak bulanık (Levenshtein tabanlı, eşik 0,92) yinelenen taraması; kaldırılan çiftler raporlanır. Tarama büyük korpuslarda arayüzü dondurmadan çalışır.
- **Analiz:** Özet kartları, yıllara göre yayın ve atıf, en üretken yazar/dergi/kurum, anahtar kelime, dil, ülke, yayın türü ve tema dağılımları, en çok atıf alan yayınlar tablosu; ayrıca **WordCloud**, **TreeMap** (dergi payları) ve **Sankey** (kaynak → dergi akışı) görselleri.
- **Ağlar:** Anahtar kelime birlikte görülme, ortak yazarlık, **bibliyografik eşleşme** ve **ortak atıf** ağları. Atıf ağları yalnızca kaynakça verisi taşıyan OpenAlex kayıtlarıyla kurulur; ortak atıf düğümlerinin başlıkları OpenAlex'ten çözümlenir.
- **LLM katmanı (Google Gemini):** Hazır görevler (bulgu yorumlama, yöntem paragrafı, tematik sentez, araştırma boşlukları, **Pilot Karar Senaryosu karar destek raporu**), **otomatik tematik sınıflandırma** (kayıtlara tema etiketi yazılır) ve **korpusla çok turlu sohbet** (Ctrl+Enter ile gönderme).
- **Doğrulama modülü:** Altın Standart CSV/XLSX ile karşılaştırma. DOI ve bulanık başlık eşleşmesi üzerinden **precision, recall, F1-score**; eşleşen çiftlerde anahtar kelime Jaccard örtüşmesi ve tema uyuşma oranı; FN/FP listeleri ve indirilebilir doğrulama raporu.
- **Dışa aktarım:** Normalleştirilmiş korpus CSV (UTF-8 BOM'lu, Excel uyumlu; tür ve tema sütunları dahil) ve JSON (OpenAlex kaynakça kimlikleri dahil).

## Doğrulama modülü: Altın Standart dosya biçimi

CSV veya XLSX. Zorunlu sütunlar: `baslik` (veya `title`), `yil` (veya `year`). İsteğe bağlı: `doi`, `anahtar_kelimeler`/`keywords` (noktalı virgülle ayrık), `tema`/`theme`. Eşleştirme önce DOI ile, ardından ±1 yıl toleranslı bulanık başlık benzerliğiyle (ayarlanabilir eşik, varsayılan 0,90) yapılır.

## Barındırma

Site GitHub Pages üzerinde `main` dalının kökünden yayınlanır ve `bibliolab.bbasaran.net` özel alan adına bağlıdır:

- Depodaki `CNAME` dosyası alan adını tanımlar (Settings → Pages → Custom domain ile otomatik oluşur; silinmemelidir).
- Cloudflare DNS'te `bibliolab` için `borabasaran.github.io` hedefli bir CNAME kaydı vardır (proxy kapalı, "DNS only").
- HTTPS, GitHub Pages ayarlarındaki "Enforce HTTPS" ile zorunludur.

Sayfanın altındaki sürüm imzası `imza.js` içindeki `SURUM` değerinden gelir; her yayımlanan değişiklikte artırılır.

## Veri kaynakları hakkında notlar

**OpenAlex (önerilen yol).** CORS açık olduğundan tarayıcıdan doğrudan çekilir. TR Dizin/DergiPark dergilerinin büyük kısmı OpenAlex'te dizinlidir; ISSN listesiyle sorgulamak hem meta veriyi hem atıf sayılarını getirir. "Polite pool" için e-posta girilmesi önerilir (Gelişmiş ayarlar).

**TR Dizin.** Arama servisinin JSON yanıtı dosya olarak yüklenebilir ya da Dosya yükle bölmesindeki "veya TR Dizin JSON yanıtını yapıştır" alanına yapıştırılabilir; esnek alan eşleyici yaygın alan adlarını (`title/baslik`, `authors/yazarlar`, `publicationYear/yil` vb.) tanır. TR Dizin sunucusu tarayıcıdan doğrudan çağrıya CORS izni vermeyebilir; bu yüzden JSON'u indirip yüklemek en güvenilir yoldur.

**DergiPark OAI-PMH.** Dergi bazında uç nokta biçimi genellikle `https://dergipark.org.tr/api/public/oai/<dergi-kisaltmasi>/` şeklindedir. CORS engeli durumunda basit bir Cloudflare Worker proxy'si yeterlidir:

```js
export default {
  async fetch(req) {
    const url = new URL(req.url).searchParams.get("url");
    const r = await fetch(url);
    return new Response(await r.text(), {
      headers: { "Access-Control-Allow-Origin": "*",
                 "Content-Type": "text/xml; charset=utf-8" }
    });
  }
}
```

Worker adresini DergiPark bölmesindeki "Gelişmiş ayarlar" altında bulunan "CORS proxy öneki" alanına `https://<worker>.workers.dev/?url=` biçiminde girin.

## Yöntemsel sınırlılık (makalelerde belirtin)

TR Dizin ve DergiPark meta verileri **kaynakça (cited references) içermez**. Bu kaynaklardan gelen kayıtlarla ortak atıf, bibliyografik eşleşme, RPYS gibi atıf ağı analizleri yapılamaz; üretkenlik, ortak yazarlık ve anahtar kelime analizleri yapılabilir. Atıf tabanlı analizler için OpenAlex kaynaklı kayıtları kullanın.

## Güvenlik ve gizlilik

- Gemini API anahtarı yalnızca tarayıcının yerel deposunda (`localStorage`) saklanır ve doğrudan Google'a gönderilir.
- Korpus yalnızca tarayıcının IndexedDB deposunda tutulur; hiçbir sunucuya yüklenmez.
- İçe aktarılan metinler sayfaya güvenli biçimde (HTML kaçışlı) basılır.
- Ortak kullanılan bilgisayarlarda iş bitince "Korpusu temizle" ile korpusu silin, anahtar alanını da boşaltın.
- Uygulama hiçbir analitik veya izleme kodu içermez.

## Lisans

MIT
