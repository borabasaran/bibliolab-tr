# BiblioLab TR

Tarayıcıda çalışan, sunucusuz bibliyometrik analiz platformu. GitHub Pages üzerinde ücretsiz barındırılır; hiçbir veri veya API anahtarı sunucuya gönderilmez.

## Özellikler

- **Veri kaynakları:** OpenAlex API (ISSN/arama/yıl filtreli, sayfalı çekim), Scopus `.csv`, Scopus/WoS `.bib`, OpenAlex `.json`/`.csv`, TR Dizin arama servisi JSON çıktısı, DergiPark OAI-PMH hasadı (Dublin Core).
- **Veri sağlığı (health check):** Alan doluluk oranları (başlık, yazar, yıl, özet, DOI vb.) ve karakter kodlama sorunu taraması; %70 altı alanlar işaretlenir.
- **Mükerrer temizleme:** Birebir DOI/başlık ayıklamaya ek olarak bulanık (fuzzy, Levenshtein tabanlı, eşik 0.92) yinelenen taraması; kaldırılan çiftler raporlanır.
- **Analiz:** EDA kartları (yayın, yazar, dergi, atıf, işbirliği endeksi), yıllara göre yayın/atıf, en üretken yazar/dergi, anahtar kelime, dil ve tema dağılımları, en çok atıf alan yayınlar tablosu.
- **Ağlar:** Anahtar kelime birlikte-görülme ve ortak yazarlık ağları (kuvvet yönelimli yerleşim, en sık 30 düğüm, kenar eşiği 2).
- **LLM katmanı:** Claude (Anthropic), Gemini veya OpenAI-uyumlu uç nokta (ChatGPT, DeepSeek vb.) ile: tek seferlik görevler (bulgu yorumlama, yöntem paragrafı, tematik sentez, araştırma boşlukları), **otomatik tematik sınıflandırma** (kayıtlara tema etiketi yazılır) ve **korpusla çok turlu doğal dilde sohbet**. Anahtar `localStorage`'da yerel tutulur.
- **Doğrulama modülü:** Manuel "Altın Standart" CSV ile karşılaştırma — DOI + bulanık başlık eşleşmesi üzerinden **precision, recall, F1-score**; eşleşen çiftlerde anahtar kelime Jaccard örtüşmesi ve tema uyuşma oranı; FN/FP listeleri ve indirilebilir doğrulama raporu.
- **Dışa aktarım:** Normalleştirilmiş korpus CSV (UTF-8 BOM'lu, Excel uyumlu, tema sütunu dahil) ve JSON.

## Doğrulama modülü — Altın Standart CSV biçimi

Zorunlu sütunlar: `baslik` (veya `title`), `yil` (veya `year`). İsteğe bağlı: `doi`, `anahtar_kelimeler`/`keywords` (noktalı virgülle ayrık), `tema`/`theme`. Eşleşme önce DOI ile, sonra ±1 yıl toleranslı bulanık başlık benzerliğiyle (ayarlanabilir eşik, varsayılan 0.90) yapılır.

## Kurulum (GitHub Pages)

1. GitHub'da yeni bir depo oluşturun (örn. `bibliolab-tr`).
2. `index.html` ve `README.md` dosyalarını depoya yükleyin.
3. **Settings → Pages → Source: Deploy from a branch → main / (root)** seçin.
4. Birkaç dakika içinde `https://<kullanici>.github.io/bibliolab-tr/` adresinde yayında olur.

## Veri kaynakları hakkında notlar

**OpenAlex (önerilen yol).** CORS açık olduğundan tarayıcıdan doğrudan çekilir. TR Dizin/DergiPark dergilerinin büyük kısmı OpenAlex'te dizinlidir; ISSN listesiyle sorgulamak hem meta veriyi hem atıf sayılarını getirir. "Polite pool" için e-posta girilmesi önerilir.

**TR Dizin.** Arama servisinin JSON yanıtı doğrudan yapıştırılabilir veya dosya olarak yüklenebilir; esnek alan eşleyici yaygın alan adlarını (`title/baslik`, `authors/yazarlar`, `publicationYear/yil` vb.) tanır. TR Dizin sunucusu tarayıcıdan doğrudan çağrıya CORS izni vermeyebilir; bu yüzden JSON'u indirip yüklemek en güvenilir yoldur.

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

Worker adresini arayüzdeki "CORS proxy öneki" alanına `https://<worker>.workers.dev/?url=` biçiminde girin.

## Yöntemsel sınırlılık (makalelerde belirtin)

TR Dizin ve DergiPark meta verileri **kaynakça (cited references) içermez**. Bu kaynaklardan gelen kayıtlarla ortak atıf, bibliyografik eşleşme, RPYS gibi atıf-ağı analizleri yapılamaz; üretkenlik, ortak yazarlık ve anahtar kelime analizleri yapılabilir. Atıf tabanlı analizler için OpenAlex kaynaklı kayıtları kullanın.

## Güvenlik

- LLM API anahtarları yalnızca tarayıcının yerel deposunda saklanır ve doğrudan ilgili sağlayıcıya gönderilir.
- Ortak kullanılan bilgisayarlarda anahtar alanını boşaltıp `localStorage`'ı temizleyin.
- Uygulama hiçbir analitik/izleme kodu içermez.

## Lisans

MIT
