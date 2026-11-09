# Değişiklik günlüğü

Lore-Forge'daki tüm önemli değişiklikler burada listelenir. Biçim [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) kurallarına, sürüm numaraları da [Anlamsal Sürümleme](https://semver.org/) kurallarına uyar.

## [1.2.0] - 2026-11-09

### Eklenenler

- **Kitabın yazı üslubu.** Dünya ayarlarında resim üslubunun yanında bir yazı üslubu var (anlatıcı, zaman, ton, okur kitlesi, kaçınılacaklar); resim üslubu da artık uygulamadan ayarlanabiliyor. Yapay zekâya sor ve Lore-Forge'a bağlı yapay zekâ uygulamaları ikisine de uyuyor. Başlamak için hazır üsluplar var: yazı için Huzurlu, Komik, Macera, Destansı, Gizem, Ürkütücü, Korku, Karanlık ve sert ile Masal; resim için de Resimsel fantastik'ten Piksel sanatı'na sekiz üslup. Örnek dünyada ikisi de ayarlı.
- **Yapay zekâ için bölüm özeti.** Bir yapay zekâ bir bölümü yazmadan ya da değiştirmeden önce Lore-Forge ona şimdiye kadarki hikâyeyi ve önceki bölümün sonunu veriyor; bölümün tarihinde kimin yaşadığını, kaç yaşında olduğunu, nerede oturduğunu ve nasıl göründüğünü, hangi yerlerin ayakta olduğunu, hangi olayların olup bittiğini ya da daha geleceğini de. Yazdığı hikâye kitaba uyuyor.
- **Yapay zekâ gibi duran anlatım işaretleniyor.** Denetim kalıp yapay zekâ sözlerini ("a testament to", "a tapestry of", "little did they know"), iki tire arasındaki ara sözleri ve "X değildi. Y idi." kalıplarını, kim yazmış olursa olsun işaretliyor: bölümlerde altını çiziyor, kayıtların özetleri, ayrıntıları ve metinleri için de listeliyor. Lore-Forge'da yazan bir yapay zekâ bunları bitirmeden düzeltiyor. Yalnızca İngilizce metinde; **Kasıtlı say** birini olduğu gibi bırakıyor.
- **Yapay zekâya sor yalnızca seçtiğiniz kısmı değiştiriyor.** Seçili metinde yeniden yazma, sürdürme ve denetleme, bölümün geri kalanını kelimesi kelimesine koruyor.
- **Haritada zaman.** Kitapta yerlere bağlı tarihli olaylar varsa haritanın altındaki çubuk onları gösteriyor. Yıl kaydırıcısı o yılın olaylarını yerlerinin yanına koyuyor ve o yıl ayakta olmayan yerleri soluklaştırıyor. Yolculuk listesi birinin haritadaki yolunu çiziyor: yaşadığı yerlerden ve katıldığı olaylardan geçerek, sırasıyla.
- **Yapay zekâya harita çizdirme.** **Harita ekle…** penceresinde **Yapay zekâya çizdir…** var: Yapay zekâ bağla bölümünde kurulan resim servisi haritayı kitabın yerlerinden oluşturulan bir istemle çiziyor; isterseniz önce istemi değiştirebilirsiniz. Adları işaretler ekliyor.
- **Dünya Kodeksi'nde haritalar.** Her harita PDF'te, önizlemede ve Markdown kopyasında yer alıyor; yerleri üzerinde numaralanmış, altında da numaralarıyla listelenmiş olarak.
- **Paylaş… ile web sitesi ya da oyun verisi.** Kitap dosyasının yanında **Web sitesi**, herhangi bir tarayıcıda internet olmadan da açılan sayfalar yazıyor: tüm kayıtlar, yerlerine tıklanabilen haritalar, zaman çizelgesi ve hikâye; adlar kayıtlarına bağlı. **Oyun verisi** de bir oyun motoru ya da kendi araçlarınız için `world-snapshot.json` dosyasını, yanında resimler ve 3B modellerle yazıyor.
- **Kitap dosyaları çift tıklamayla açılıyor** (Lore-Forge kuruluysa) ya da pencereye bırakılınca. Aynı dosya yeniden açılınca yeni bir kopya yapılmıyor, raftaki kopya açılıyor.
- **Arama bölümleri ve haritaları da buluyor.** Ctrl+F, kayıtların altında eşleşen bölümleri (önce başlığa, sonra metne göre) ve haritaları listeliyor. Bir bölüm, bulunan sözcüklerde açılıyor.

### Değişenler

- Yeni bir sürümün yama notları, sürüm yayımlandığında numarasını ve tarihini alıyor; hem uygulamada hem sürüm sayfasında.

### Düzeltilenler

- Hakkında penceresi ile Dünya Kodeksi ve Hikâye Kitabı'nın künye satırları artık çalışan sürümü gösteriyor. 1.1.0'da hâlâ 1.0.0 yazıyordu.
- Kenar çubuğundaki arama sonuçlarında artık başıboş noktalar görünmüyor; uzun bir ad da resminin yanında tek satırda kalıyor.
- Bir bölümün daha uzun bir kısmını (bir satırdan uzun ya da paragraflar) seçince, seçimin yanında ve sağ tıklamada **Bu kısım hakkında yapay zekâya sor** çıkıyor. Önceden bir addan uzun seçimlerde hiçbir şey görünmüyordu.

## [1.1.0] - 2026-11-09

### Eklenenler

- **Türkçe.** **Ayarlar → Dil**, uygulamanın tamamını bayraklarıyla birlikte İngilizce ve Türkçe arasında değiştiriyor: tüm ekranlar, uyarılar ve kural adları, yama notları, Dünya Kodeksi ve Hikâye Kitabı'ndaki etiketler. Siz bir dil seçene kadar Lore-Forge sistemin dilini kullanıyor.
- **Kitabın içinde Ayarlar:** **Dünya ayarları**'nın yanındaki dişli, kütüphanedekiyle aynı Ayarlar'ı açıyor (dil, görüntü, dünyalar klasörü, örnek dünya). Dünya ayarları artık takvim simgesiyle gösteriliyor.
- Kütüphanede **Yama notları**: her sürümde nelerin değiştiği, en yenisi en üstte; uygulamayla gelen değişiklik günlüğünden okunuyor (internet gerekmiyor). Güncelleyicinin bulduğu daha yeni bir sürüm, notlarıyla birlikte en üstte görünüyor.
- **Düzenleyicide geri alma ve yineleme.** Ctrl+Z, açık kaydın son değişikliğini ne olursa olsun geri alıyor: bir durum (hayatta → ölü), bir listeden seçim, bir görsel ya da simge, eklenen ya da silinen bir satır, ya da yazılan metin (her duraklama bir adım). Ctrl+Y veya Ctrl+Shift+Z yineliyor. İlgili alan görünür hale gelip kısa bir süre parlıyor. Uygulama dışında (bir yapay zekâ asistanı ya da bir düzenleyici tarafından) sonradan yapılan bir değişiklik asla yanlışlıkla geri alınmıyor.
- **GIF görseller.** Hareketli GIF'ler, görselin göründüğü her yerde oynuyor. Dünya Kodeksi ve Hikâye Kitabı (PDF ve Word), GIF'i dışarıda bırakmak yerine ilk karesini basıyor.
- Örnek dünyada Mr Camel'ın portresi artık hareketli bir GIF (çaydanlığından buhar yükseliyor) ve bir 3B modeli var.
- **Yapay zekâya sor.** Uyarılar'ın yanındaki sekme, açık kitap üzerinde Claude Code ya da Codex'i çalıştırıyor. Bir görev yazın (*“Sonraki bölümü yaz”*, *“Açık uyarıları düzelt”*), yanıtlarını, adımlarını ve yaptığı her değişikliği olurken izleyin; adımlarındaki adlar kayıtlara bağlantı veriyor.
  - Kendi Claude ya da ChatGPT planınızla çalışıyor, Claude kullanım sınırınıza yaklaştığınızda söylüyor ve istediğiniz an durdurulabiliyor.
  - Yalnızca Lore-Forge'un kendi araçlarını kullanabiliyor: komut çalıştıramıyor, başka dosyalara dokunamıyor, web'e çıkamıyor.
  - Her kitap kendi sohbetini saklıyor; böylece ardından sorulan sorular da yanıtlanıyor, uygulama yeniden başlasa bile. Ctrl+J ile açılıyor.
  - **Bu konuda yapay zekâya sor:** her kayıtta ve Hikâye görünümünde (seçtiğiniz metin için de, sağ tık menüsünde de) bulunan **Yapay zekâya sor** düğmesi, neyi kastettiğinizi yapay zekâya bildiriyor ve uygun öneriler sunuyor.
- **Kitap geçmişi.** Lore-Forge her kitabın anlık görüntülerini bu bilgisayarda saklıyor: kitap açıldığında, kitap değiştikçe 20 dakikada bir, her yapay zekâ görevinden ve her geri yüklemeden önce.
  - Ana sayfadaki **Geçmiş**, herhangi bir anlık görüntüden beri nelerin değiştiğini gösteriyor ve bir kaydı, bölümü ya da görseli, istenirse kitabın tamamını geri yüklüyor.
  - Bir kaydın başlığındaki **Geçmiş**, o kaydın önceki sürümlerini alan alan gösteriyor; **Bu sürümü geri yükle** ile geri getiriyor.
  - Her geri yükleme de geri alınabiliyor.
- **Yapay zekâ görevini geri alma.** “Yapay zekâya sor” kitabı değiştirdiğinde panel nelerin değiştiğini **Geri al** düğmesiyle listeliyor. O sırada sizin yaptığınız düzenlemelere dokunulmuyor; değişen bir şey sonradan yeniden düzenlendiyse önce soruyor.
- **Uygulamanın içinden resim yapma.** Bir kaydın resimlerinin altındaki **Resim yap…** (ve her resimdeki, yenisini yapan düğme), Yapay zekâ bağla'da kurulan resim servisiyle bir resim çiziyor. İstem, görsel tanımdan ve kitabın resim üslubundan oluşturuluyor ve önce değiştirilebiliyor; resim, bulunduğunuz görünüş için kendi görünüm kutusuna yerleşiyor. Yapay zekâ araçları ve uygulama aynı istemi oluşturuyor.
- **İngilizce ve Türkçe yazım denetimi.** **Ayarlar → Yazım**, denetlenecek dilleri seçiyor: English (US), English (UK), Türkçe ya da hiçbiri. Altı dalgalı çizili bir sözcüğe sağ tıklayınca öneriler ve sözlüğe ekleme çıkıyor; Hikâye'de bunlar metnin kendi menüsünün en üstünde. Açık kitaptaki adlar, kitap açıkken doğru yazılmış sayılıyor. Metin alanlarında sağ tık artık Kes, Kopyala, Yapıştır ve Tümünü seç de sunuyor.
- **Kitabı tek dosya olarak paylaşma.** Ana sayfadaki **Paylaş…**, kitabın tamamını (kayıtlar, bölümler, resimler, haritalar, 3B modeller ve ayarlar) tek bir `.loreforge` dosyası olarak kaydediyor; birine gönderebilir ya da yedek olarak saklayabilirsiniz. Kitaplıktaki **Kitap dosyası aç…**, paylaşılan bir kitabı kendi kopyası olarak rafa ekliyor ve açıyor.
- **Dünya haritaları.** Yeni **Harita** görünümü (Ctrl+5), dünyanın haritalarını ve üzerlerinde işaretli yerleri gösteriyor.
  - **Harita ekle…** bir harita resmi alıyor. Bir kitabın birden çok haritası olabilir (dünya, bir bölge, bir şehir); tek bir yerin haritası, o yerin öteki haritalardaki işaretinden açılıyor.
  - Her işaret yerin resmini ve adını gösteriyor. Üzerine gelince orada kimin yaşadığı, neler olduğu ve içindeki yerler görünüyor; tıklayınca yer açılıyor.
  - **İşaretleri düzenle**: yerleri haritaya, işaretleri haritanın üzerinde sürükleyin, bir işareti ok tuşlarıyla kaydırın, Ctrl+Z ile geri alın.
  - Yapay zekâ asistanları harita ekleyebiliyor (`save_map`), bir haritaya işaretleriyle bakabiliyor (`get_map`) ve yerleri `save_entries` ile işaretleyebiliyor. Yeni `map-pin` denetimi, kitapta olmayan bir haritadaki işaret için uyarıyor.
  - Örnek dünyada bir Sunsea haritası var; üzerinde Camelamamm, The Glass Dunes ve The Hollow of Echoes işaretli.
- **Görünüşler.** Bir kayıt zamanla farklı görünebilir: bir savaştan sonra, taç giyme kıyafetiyle, yaşlılıkta. Düzenleyicinin Görünüş bölümünde **+ Yeni görünüş**, **Varsayılan** görünüşün yanına yenisini ekliyor: adı, neden farklı göründüğü ve ne zaman geçerli olduğu (her zaman, bir olaydan sonra ya da önce, iki tarih arasında ya da bir çağda). Her görünüşün kendi görsel tanımı (yalnızca değişenler; gerisi Varsayılan görünüşten geliyor), kendi görselleri ve kendi 3B modelleri var.
  - Denetimler; olmayan bir çağa ya da olaya bağlı görünüşler, doğumdan önce ya da ölümden sonra başlayan görünüşler ve aynı anda geçerli iki görünüş için uyarıyor.
  - Zaman çizelgesinde, bir kaydın kartının altındaki altın rengi çizgi her görünüşün ne zaman geçerli olduğunu gösteriyor; tıklayınca kayıt o görünüşüyle açılıyor.
  - Dünya Kodeksi her görünüşü görselleri ve kendi sanatçı özetiyle gösteriyor; bir olayın sanatçı özeti de her katılımcıyı o tarihteki görünüşüyle anlatıyor.
  - Yapay zekâ asistanları görünüş ekleyip değiştirebiliyor ve silebiliyor, kayıtların bir tarihte nasıl göründüğünü sorabiliyor (yeni `look_at` aracı), tarihli bir bölümde adı geçenlerin görünüşlerini görüyor ve bir görünüşün görselini yapıp ekleyebiliyor.
  - Örnek dünyada Mr Camel'ın “Caravan days” görünüşü bir örnek.
- **İndirme:** 3B modelin yanındaki **İndir…** ve her görseldeki indirme düğmesi, dosyanın bir kopyasını istediğiniz yere kaydediyor; böylece başka programlarda da kullanabiliyorsunuz (bir yapay zekâ asistanının yaptıkları için de işe yarıyor).
- **Görüntü ayarları**, **Ayarlar** penceresinde:
  - pencere (Pencerede, Ekranı kapla ya da Tam ekran);
  - çözünürlüğü (1280 × 720, 1366 × 768, 1600 × 900, 1920 × 1080, 2560 × 1440 ya da 3840 × 2160);
  - arayüz ölçeği (Otomatik ya da %80 ile %150 arası). Otomatik, 1920 × 1080 için hazırlanan tasarımın oranlarını koruyor: arayüz 2K ve 4K ekranlarda büyüyor, küçük pencerelerde küçülüyor.
  - F11 tam ekranı açıp kapatıyor; Ctrl +, Ctrl − ve Ctrl 0 ölçeği değiştiriyor.
  - Arayüz düzeni de 1280 × 720 çözünürlükte ve %100 ölçekteki 2K ekranlarda daha iyi oturuyor.

### Değişenler

- Cinsiyet önerileri artık non-binary yerine kadın (♀), erkek (♂) ve cinsiyetsiz (⚲).
- 3B modeller açılınca kendiliğinden dönüyor (Otomatik döndür açık başlıyor); sistem azaltılmış hareket istiyorsa dönmüyor.
- Bir 3B modeli silmek gibi sorular, diğerleri gibi tüm pencereyi karartıyor.
- Uyarılar paneli artık daha geniş; yanındaki “Yapay zekâya sor” kadar.
- Bir resmin düğmeleri artık daha rahat: Ayrıntılar ve Kaldır resmin üst köşelerinde; Yeni resim yap, Değiştir ve Kopyasını kaydet alttaki tek bir şeritte.
- Dünyanın ana sayfasında **Dünya ayarları**'nın yanında artık **Ayarlar** da var; dili değiştirmek Ayarlar penceresini kapatmıyor.
- **Kütüphane ayarları**'nın adı artık **Ayarlar**. Görüntü ayarları her satırın altında kendini açıklamıyor; çözünürlüklerde de HD, Full HD, 2K ve 4K etiketleri yok.
- **Hikâye önerileri çok daha fazlasını, çok daha az yanlışla buluyor.**
  - Bir adın son kelimesi, neyin adı olduğunu gösteriyor. “Hollin Wood” ve “the Copper Market” yer, “the Seven Founders” topluluk, “the Copper Paddle” eşya, “the Great Rockfall” ise olay olarak tanınıyor. “Edmund Hall” yine kişi olarak kalıyor.
  - Yerler artık “the” ile birlikte yer bildiren kelimelerden sonra (“across the Red Erg”), “of the” kalıbından sonra (“the shaft of the Moon Well”) ve adlarının sonuna bakılarak (“the Millpond”, “the Greywood”) bulunuyor.
  - “The Hall of Heroes” ve “the Ringing of the Bell” bölünmeden, tam adlarıyla alınıyor. “The Sunblade, a sword…” eşya, “rode out of Highgate” ise yer olarak tanınıyor.
  - Tek başına geçen bir ilk ad (“Rhys”), tam adı bununla başlayan tek yeni kişiye (“Rhys Varn”) bağlanıyor.
  - Artık ad olarak önerilmeyenler: büyük harflerle yazılmış tabelalar, emirler (“Hang it on the bell”), meslek ya da nesne çoğulları (“Carpenters”, “Engines”) ve iyelik biçimindeki sahip adları (“the Heralds' vault”).
  - Yapay zekâ asistanlarıyla yazılmış dört kitapta adı geçen kişi, yer, topluluk, eşya ve olayların %95'i bulunuyor (önceden %68'i); bunların %98'i de doğru türü alıyor.
- **Hikâye denetimi 5 ila 10 kat daha hızlı**, sonuçlar ise aynı. Değişmeyen bir bölüm yeniden okunmuyor: bir bölüme yazarken yalnızca o bölüm denetleniyor; bir kaydı düzenlerken ise, bir ad değişmedikçe hiçbir bölüm denetlenmiyor.
- **Tutarlılık kuralları büyük dünyalarda yaklaşık 8 kat daha hızlı.** 1.000 kayıtlı bir dünyada bir denetim 42 ms yerine 5 ms sürüyor. Uzun bir soy hattı artık kuralları yavaşlatmıyor ya da durdurmuyor.
- **Büyük dünyalarda yazmak akıcı kalıyor:**
  - Bir bölüme yazmak artık kuralları çalıştırmıyor.
  - Bir denetimin 8 ms'den uzun sürdüğü çok büyük dünyalarda, bir kayda yazarken kurallar her tuşta değil, kısa bir duraklamadan sonra çalışıyor.
  - Kayıt seçme alanları, tüm kayıtların listesini ancak liste açılınca hazırlıyor.
  - Ad vurgulama tüm metin kutularında ortak kullanılıyor ve yalnızca bir ad yazarken ara verdiğinizde yeniden oluşturuluyor.
  - 100'den uzun listeler değiştiğinde artık kaymıyor; bu da her tuş vuruşunda birkaç milisaniye kazandırıyor.
- **Uyarı kimlikleri** artık satırların sırasına bağlı değil; böylece bir ilişki, konum ya da görsel eklenip silindiğinde kasıtlı işaretler ait oldukları uyarılarda kalıyor. Eski kimliklerle kaydedilmiş işaretler de geçerliliğini koruyor.

### Düzeltilenler

- **Siz yazarken dışarıdan yapılan değişiklikler** (bir yapay zekâ asistanı, bir metin düzenleyici ya da git ile) artık bir sonraki kaydetmede kaybolmuyor; aynı kayıt ya da bölümdeki düzenlemelerinizle birleştiriliyor. Diğer dosyalar, kaydetmenizi beklemeden hemen güncelleniyor. Kaydetme, az önce değişmiş bir dosyanın üzerine hiçbir zaman yazmıyor: dosya önce birleştiriliyor.
- **Pencereyi kapatmak**, kaydedilmeyi bekleyen her şeyi kaydediyor. Kaydedilemeyen bir şey varsa Lore-Forge kapatmadan önce soruyor.
- Dosyalar bütün olarak yazılıyor: kaydetme sırasında bir çökme ya da elektrik kesintisi hiçbir zaman yarım dosya bırakmıyor.
- **Adı silinen bir kayıt** artık bir sonraki yüklemede kaybolmuyor: adı olmadığını bildiren bir uyarıyla yükleniyor.
- **Yarım doldurulmuş satırlar korunuyor**: bir sonraki yüklemede atılmıyor, tarihleri ve notlarıyla kalıyor. Örneğin henüz hedefi olmayan bir ilişki, yeri olmayan bir konum ya da yapanı olmayan bir eylem.
- **Yeni kayıtlar, var olan bir dosyanın üzerine hiçbir zaman yazmıyor:** ister okunamamış bir dosya olsun, ister elle adlandırılmış.
- **Başarısız olan bir kaydetme** (kilitli ya da salt okunur bir dosya) bekletiliyor ve yeniden deneniyor. Kaydetme göstergesi ve Ctrl+S bunu bildiriyor; kütüphaneye dönerken de kaydetme bekleniyor ve **Yine de kapat** seçeneği sunuluyor.
- Kayıt değişirken (örneğin bir yapay zekâ asistanı ona yazarken) resim eklemek, artık kaydın ve dünyanın eski hâlini geri getirmiyor.
- Elle yazılan noktalı tarihler yazıldığı gibi okunuyor. `born: 03.1920` önceden Mart 192 olarak okunuyordu ve kaydedilince dosyaya öyle yazılıyordu.
- Uzun olaylar artık yanlış hata vermiyor: bir savaşın yalnızca bir kısmını yaşamış biri de, bulunduğu yer kurulmadan önce yapımına başlanmış bir yapı da sorun sayılmıyor.
- Çağının dışında kalan bir tarih için uyarı veriliyor: çağ bittikten sonraki bir tarih ya da daha eski bir çağ varken çağ başlamadan önceki bir tarih. Hikâye bölümlerinin tarihleri de denetleniyor.
- İlişki olarak yazılan bir öldürme artık `dead-marked-alive` kuralında hesaba katılıyor; yalnızca bir öldürmeden bilinen bir ölüm de `after-death` kuralında.
- Şunlar için artık yanlış uyarı çıkmıyor:
  - günü belirtilmiş tarihlerle art arda gelen konumlar;
  - tarihlerinin dışında bir olaya “katılan” notlar ve olaylar;
  - boş satırlar;
  - bitişi başlangıcıyla aynı olan tek günlük bir olay.
- Büyük harfle yazılmış ilişki türleri (“Parent-of”) artık tanınıyor.
- `world.json` içindeki hatalı bir takvim ya da kural ayarı artık denetimleri durdurmuyor; bildiriliyor.
- **Hikâye uyarıları:**
  - bir kayıtla çelişen sonraki bir cümle, önceki bir cümle kayıtla uyuşsa bile bildiriliyor;
  - hikâyede var olan bir olaya tarih verildiğinde o olay denetleniyor;
  - **Git** bunu söyleyen cümleye götürüyor, mesajda da bölümün adı geçiyor.
- Bir önerinin **Ekle** ya da **Uygula** düğmesine iki kez tıklamak yalnızca bir kez ekliyor; kart da hemen kayboluyor.
- Soy ağacında ya da ilişki ağında bir bağlantı değişikliğini geri aldığınızda (Ctrl+Z) yalnızca o değişiklik geri alınıyor.
- Diğer adlar ve liste alanları uygulama dışında yapılan değişiklikleri gösteriyor; böyle bir değişiklikten sonra imleç de artık metnin sonuna atlamıyor.
- Özel ilişki türü olarak “kan kardeşi”, öneri sunan alanlara “Liman kasabası”, sıra alanına da negatif ya da ondalıklı sayılar yazılabiliyor.
- Kayıttan Alt+← ya da farenin geri düğmesiyle çıktığınızda, bir kayıt alanına yazdığınız metin korunuyor.
- Okunamayan bir dosyada **Git**, dosyanın klasörünü açıyor. Bir görsel uyarısında Görseller sekmesini açıyor; durum ve ilişki türü alanları da artık odağı alıyor.
- Bir kayıt silindiğinde ona ait kasıtlı işaretler de kaldırılıyor. Dosyası silinemeyen bir kayıt, bir mesajla birlikte listede kalıyor.
- Pencere bir süre dar kaldıktan sonra kenar çubuğu eski genişliğine dönüyor.

## [1.0.0] - 2026-11-07

İlk herkese açık sürüm. 4 Kasım'da yayımlanan indirmeler 7 Kasım'da bu derlemeyle değiştirildi; bu derleme yapay zekâ asistanlarını, otomatik güncellemeyi ve aşağıda listelenen her şeyi getiriyor.

- Windows, macOS ve Linux için masaüstü uygulaması: kütüphane rafı, dünya ana sayfası ve kitap kapakları; karakterler, yerler, topluluklar, eşyalar, olaylar ve notlar için düzenleyici.
- Çağları, ayları ve kısmi tarihleriyle özel takvimler.
- Uygulamada canlı çalışan, `lore check` ile de kullanılabilen 16 tutarlılık kuralı.
- Zaman çizelgesi, soy ağacı ve ilişki ağı.
- Bölüm metinleri, kayıt önerileri ve hikâye çelişkisi denetimleriyle hikâye alanı.
- Dünya Kodeksi (PDF) ve Hikâye Kitabı (PDF, Word ve Markdown).
- Örnek dünya Camelamamm.
- MIT lisansı.

### Eklenenler

- **Yapay zekâ asistanları (MCP).** Claude Desktop, Claude Code, Codex, Cursor ve diğer yapay zekâ uygulamaları için bir MCP sunucusu: `lore mcp`.
  - “Lore-Forge'da develer hakkında bir hikâye” istendiğinde asistan kitabı oluşturuyor ve her şeyi içine yazıyor: ayrıntılarıyla kayıtlar, ilişkiler, bir takvim, bölümler ve resimler. Kitapta çelişki olup olmadığını da denetliyor ve bulduklarını düzeltiyor.
  - Sunucunun 18 aracı ayrıca var olan kitapları okuyor, sürdürüyor ve değiştiriyor, uyarıları kasıtlı sayıyor, Hikâye Kitabı'nı ya da Dünya Kodeksi'ni dışa aktarıyor. Ayrıntılar için [docs/MCP.md](docs/MCP.md) dosyasına bakın.
- Kütüphanede **Yapay zekâ bağla**:
  - bu uygulamaları tek tıklamayla bağlıyor, istenirse yeniden kaldırıyor;
  - diğer uygulamalar için ayarları kopyalıyor;
  - **Resimler** bölümünü kuruyor: kendi anahtarınızla OpenAI, Google Gemini ya da xAI Grok (anahtar bilgisayarınızdan çıkmıyor) ve anahtarın kullanabildiği en yeni görsel üretim modeli.
- **Canlı güncellemeler:** raf ve açık kitap, uygulama dışında yapılan değişiklikleri (bir yapay zekâ asistanı, bir metin düzenleyici ya da `git pull` ile) bir an sonra gösteriyor.
- `artStyle` (`world.json` içinde): bir kitabın resimlerinin görünüşünü tarif eden, her resim istemine eklenen tek satır.
- **Dünyanın kopyasını oluştur**: rafta Sil düğmesinin yanında ve dünyanın ana sayfasında. Yeni bir kimlik alan ve kapağını da taşıyan kopya hemen açılıyor. Salt okunur örnek dünyada da çalışıyor. `lore duplicate` aynı işi komut satırından yapıyor.
- **İlk açılış turu** (kütüphanede ve örnek dünyada sekiz adım): Geç, Geri, İleri düğmeleri ve Esc tuşuyla. Yalnızca bir kez gösteriliyor; kütüphanedeki ve Hakkında penceresindeki **Turu başlat** düğmesiyle yeniden açılabiliyor.
- Kayıtlar için **3B modeller**: düzenleyicide **Görseller | 3B model** sekmeleri. `.glb`, gömülü `.gltf`, `.obj` ve `.fbx` dosyaları, kayıt başına birden çok olmak üzere `models/<entry-id>/` klasöründe saklanıyor. Görüntüleyici (three.js) modelin çevresinde dolaşmayı, yakınlaştırmayı, kaydırmayı, sıfırlamayı ve otomatik döndürmeyi destekliyor.
- Örnek dünya Camelamamm için resimler: kayıtları ve kapağı için portreler ve sahneler.
- **Otomatik güncelleme** (GitHub Releases üzerinden):
  - açılışta ve dört saatte bir denetim;
  - bir bildirim (İndir, Sonra ve Yenilikler), ardından ilerleme durumu ve Güncellemek için yeniden başlat düğmesi;
  - **Hakkında → Güncellemeler** bölümünde Şimdi denetle düğmesi ve bir açma/kapama anahtarı var.
  - Dünyalara hiçbir zaman dokunulmuyor.
- **`lore` komut satırı aracı** uygulamayla birlikte geliyor: `/usr/bin/lore` (`.deb` paketinden), Windows'ta `resources\bin\lore.cmd`, macOS'te `Lore-Forge.app/Contents/Resources/bin/lore`.
- Sürümden sürüme hiç değişmeyen kalıcı indirme bağlantıları (`releases/latest/download/Lore-Forge-amd64.deb` vb.). Her sürümde bu adlarla beş yükleyici, ayrıca güncelleyicinin `latest*.yml` dosyaları bulunuyor.

### Değişenler

- **Zaman çizelgesi için yeni tasarım**, uygulamanın görünümünde bir Gantt şeması:
  - çağ şeritleri ve renkli çağ sütunları;
  - yerinde sabit kalan bir yıl ekseni, yakınlaştırınca aylarla birlikte;
  - her türün renginde simge, ad ve tarihler taşıyan dolgulu kartlar, resmi olan kayıtlar için de resimli kartlar;
  - her türün kayıtlarını yan yana dizen **Yığılmış** düzen;
  - görünen bölümü görmek ve kaydırmak için bir **Genel bakış** şeridi.

  Kaydırma ilk ve son yılda duruyor. Araç çubuğu daha belirgin tür çipleriyle tek bir çubuk; ipucu satırı ve ölçek göstergesi artık yok.
- Zaman çizelgesindeki grup başlıklarında artık çizgi şeridi yok; zaman çizelgesini kaydırmak ve yakınlaştırmak daha akıcı.
- Kenar çubuğundaki tür grupları artık yanlarında renkli bir şerit yerine her başlığın altında ince bir çizgi olan yumuşak paneller. Seçili kayıt ve bölüm yumuşak, altın kenarlı bir kart olarak görünüyor; satırların üzerine gelindiğinde hafif bir çerçeve beliriyor.
- Bir dünyada uyarılar varken yazmak artık takılmıyor. Hikâye denetimi, yazmayı bıraktıktan çeyrek saniye sonra ya da alandan çıkar çıkmaz güncelleniyor ve yaklaşık üçte bir daha hızlı. Zaten kullanılan bir ad ya da doğumdan önceki bir ölüm gibi kural uyarıları, yazarken görünmeye devam ediyor.
- Düzenleyicideki **Durum ve tarihler**, kalın renkli bir sol kenar yerine yumuşak altın çerçeveli, başlığında kum saati olan bir kart. Kayıt çiplerinde ve uyarılarda da renkli sol kenar yok: bir uyarının tüm çerçevesi önem derecesinin rengini alıyor.
- Zaman çizelgesi hemen açılıyor; sürüklerken ve yakınlaştırırken akıcılığını koruyor. Resimler sayfaya, metin olarak yazılmış tam dosyalar yerine kısa bağlantılar olarak veriliyor; üzerine gelince açılan kart da artık her şeridi yeniden çizmiyor.
- Zaman çizelgesini uzaklaştırmak, yılların şeridi doldurduğu noktada duruyor; böylece ilk yıldan önce ya da son yıldan sonra boş zaman görünmüyor.
- Zaman çizelgesinin **Genel bakış** şeridini sürüklemek (**Sığdır** düğmesine bastıktan hemen sonra da) görünümü hiçbir zaman ilk ya da son yılın ötesine taşımıyor: her hareket, çizilmeden önce yılların içinde tutuluyor.
- **Hakkında → Güncellemeler** bölümünde artık dünyaların nerede saklandığına dair küçük not ve tüm sürümlere giden bağlantı yok.
- Düzenleyici, kenar çubuğundaki gibi kaydın resmini adının yanında bir daire içinde gösteriyor; resmi olmayan kayıtlar tür simgelerini koruyor.
- Kenar çubuğundaki **+ Yeni**, Escape tuşuna ya da × düğmesine basınca, boş bırakılınca veya başka bir yere tıklanınca hiçbir şey eklemeden kapanıyor.
- **Durum ve tarihler**, düzenleyicinin geri kalanı gibi sade bir alan grubu. Düzenleyicinin üst kenarında renkli şerit yok; kaydın kimliği ve dosyası, adının altında iki küçük çip olarak görünüyor.
- Soy ağacı ve ilişki ağı kartlarında sakin bir çerçeve (ölüler ya da yıkılmışlar için kesikli ve gri) ve açık kayıtta yumuşak altın bir halka var; sol yanlarında renkli şerit yok. Soy ağacı açıklamasında yalnızca “ölü” yazıyor.
- İlişki listelerindeki bağlantılar (örneğin “Sahiplik geçmişi” alanından gelen “sahip olduğu …”) etiketlerini kayıt çipinin üstünde, ayrıntılarını altında gösteriyor; düzenleme düğmesi ayrı bir sütunda. **Burada geçenler** gibi kayıt çiplerinde simgeler ve adlar hizalı.
- **Dünya ayarları** artık takvimin altında “world.json dosyasına kaydedilir” notunu tekrarlamıyor.
- **Yeni kitap** penceresinde kapağın yanındaki sırt, kapakla aynı boyda.
- Kütüphane rafı pencerenin tüm genişliğini kullanıyor; sıralar ortalanıyor, kitaplar pencereye göre boyutlanıyor (1200 px altında biraz daha küçük, 2K ekranlarda daha büyük).
- Sırtlardaki ve kapaklardaki kitap başlıkları sığmak için küçülüyor ve dengeli satırlara bölünüyor; çok uzun başlıklarda üç nokta yalnızca son çare.
- Sürümler **Actions → Release** ile çıkarılıyor (sürüm yükseltme, testler, derlemeler ve yayın tek çalıştırmada).
- README yeni kullanıcılar için yeniden yazıldı; başvuru belgeleri `docs/` klasörüne taşındı. Topluluk dosyaları ile hata bildirimi ve özellik isteği şablonları eklendi.

### Düzeltilenler

- Hikâye önerileri, bir cümlenin ya da alıntının başındaki gündelik kelimeleri artık yeni karakter olarak önermiyor:
  - kısaltmalar (“I'm”, “Don't”);
  - sorular ve emirler (“Are you…”, “Remember…”);
  - sayılar;
  - bölümde zaten geçen kelimelerin çoğulları ya da -ing biçimleri (“Bells”, “Flying”).
- Hikâye Kitabı her zaman telif hakkı sayfasını içeriyor. Telif hakkı alanı boşsa yine de yazar ve yılla sade bir bildirim basılıyor. Örnek kitap A4 boyutunda; ithaf sayfasını ve epigrafını koruyor.

### İlk 1.0.0 kullanıcıları için not

7 Kasım 2026'dan önce indirilen kopyalarda güncelleyici yok. Güncel sürümü README dosyasındaki bağlantılardan bir kez indirin; bundan sonra Lore-Forge kendi kendini güncelleyecek.

[1.2.0]: https://github.com/kaharamamm/Lore-Forge/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/kaharamamm/Lore-Forge/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/kaharamamm/Lore-Forge/releases/tag/v1.0.0
