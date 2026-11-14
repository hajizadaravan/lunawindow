# LunaWindow üçün real məlumatlara əsaslanan 3D mənbə seçimi

Yoxlama tarixi: 2026-11-14. Bu sənəd mənbə seçimi və inteqrasiya planıdır; 3D səhnə hələ qurulmayıb. Mövcud analiz və məlumat faylları dəyişdirilməyib.

## Tövsiyə olunan dəst

| Rol | Mənbə | İstifadə |
|---|---|---|
| Üç nöqtə üçün ortaq relyef | [PGDA 90 — LDEM_80S_40MPP_ADJ.TIF](https://pgda.gsfc.nasa.gov/products/90) | İlk 3D versiya və uzaq horizont. Mövcud analizlə eyni mənbə. |
| A nöqtəsinin detalları | [PGDA 78 — Site01](https://pgda.gsfc.nasa.gov/products/78) | 5 m şəbəkədən yaxın səth modeli; əlavə uyğunlaşdırma yoxlamasından sonra. |
| B nöqtəsinin detalları | [PGDA 78 — Site23](https://pgda.gsfc.nasa.gov/products/78) | Malapert sahəsi, 5 m şəbəkə; əlavə uyğunlaşdırma yoxlamasından sonra. |
| C nöqtəsinin detalları | [PGDA 81 — ldem_87s_5mpp](https://pgda.gsfc.nasa.gov/products/81) | 5 m qütb mozaikasından kiçik hissə. B bu mozaikanın xaricindədir. |
| Uzaqdan bütöv Ay | [NASA SVS 14959 — moon_small.glb](https://svs.gsfc.nasa.gov/14959/) | 13.2 MB hazır rəngli kürə; lokal relyef analizi üçün deyil. |
| Yer görünüşü | [NASA Earth with Clouds](https://science.nasa.gov/resource/earth-with-clouds-3d-model/) | Yer üçün vizual model; mövqe və göydə ölçü efemeriddən gəlməlidir. Buludlar missiya tarixinə aid müşahidə deyil. |

Tam endirmə URL-ləri və GeoTIFF yoxlama nəticələri `3d-source-verification.json` faylındadır. Mənbə GeoTIFF-ləri hazır GLB deyil: onların ölçülmüş hündürlüklərindən səth toru hazırlanmalıdır.

## Bu sessiyada nə yoxlanıldı

HTTP Range sorğuları ilə dörd real GeoTIFF-in başlığı, ölçüsü, piksel addımı, proyeksiya parametrləri və coğrafi bağlanması oxundu. GB-lıq fayllar bütöv endirilmədi.

| Mənbə | Raster ölçüsü | Fayl ölçüsü, decimal MB | Əhatə düzbucaqlısında olan demo nöqtələr |
|---|---:|---:|---|
| Regional 40 m | 15200 × 15200 | 716.30 | A, B, C |
| Site01 5 m | 3200 × 3200 | 40.98 | A |
| Site23 5 m | 4200 × 4200 | 70.59 | B |
| Qütb mozaikası 5 m | 40000 × 40000 | 3465.29 | A, C |

Bu əhatə yoxlaması məhz raster düzbucaqlısına aiddir. Nöqtələrdə pikselin NaN olmaması, fərqli məhsulların hündürlük fərqi və tikişlərdə uyğunlaşma hələ yoxlanmayıb.

Oxunan bütün başlıqlarda: cənub qütb stereoqrafik proyeksiyası, başlanğıc enliyi −90°, mərkəzi meridian 0°, miqyas 1, sıfır yerdəyişmə, radius 1 737 400 m, metr vahidi və `PixelIsArea` var. Məhsul səhifələri koordinat çərçivəsini MOON_ME / DE421 kimi müəyyən edir. Köhnə faylların ümumi CRS adları fərqlidir; adların fərqli olması proyeksiya rəqəmlərinin fərqli olması demək deyil.

5 m məhsulların şaquli başlanğıcını yalnız kürə radiusu teqindən çıxarmaq olmaz. Onların hündürlüklərini mövcud 40 m məhsulla üst-üstə düşən sahədə müqayisə etmək lazımdır.

## Birlikdə işləmək üçün konkret qaydalar

1. **İlk versiya:** bütün üç lokal 3D səthi mövcud 40 m mənbədən qurmaq. Yaxınlaşdırma zamanı yeni detal uydurmamaq.
2. **Sonrakı versiya:** uyğun 5 m məlumatı içəri əlavə etmək; əvvəl hündürlük, koordinat və piksel mərkəzi uyğunluğunu ölçmək. Eyni birləşdirilmiş səthi həm görüntü, həm horizont hesablamasında işlətmək. Əvvəlki 40 m analizini səssizcə 5 m səthlə qarışdırmamaq.
3. **Miqyas:** səthdə 1 vahid = 1 metr. Analiz görünüşündə şaquli şişirtmə 1×. Lokal başlanğıc nöqtəsindən istifadə edərək böyük koordinatların qrafik dəqiqliyinə təsirini azaltmaq.
4. **Oxlar:** əvvəl Ayın sabit koordinatlarında sferik nöqtələr yaratmaq, sonra lokal şərq–şimal–yuxarı sisteminə çevirmək. Y-yuxarı qrafik səhnədə x=şərq, y=yuxarı, z=−şimal uyğunlaşdırması tətbiq edilə bilər. Uzaq relyefi düz müstəvi kimi modelləşdirməmək.
5. **Piksel mərkəzi:** başlıqda PixelIsArea olduğuna görə GeoTIFF başlanğıcından yarım piksel daxilə keçmək. PGDA-nın “pixel-registered” ifadəsini ayrıca ikinci yarım-piksel sürüşməsi kimi tətbiq etməmək.
6. **Günəş/Yer:** eyni vaxt kursoru və mövcud Horizons istiqamətləri. Onların DE441 MEAN_ME çərçivəsi ilə LOLA DE421 fərqi layihədə hələ ölçülməyib; tam uyğunluq iddiası verilməməlidir.
7. **Sonrakı dəqiq çərçivə həlli:** SPICE istifadə edilərsə, efemerid, Ayın orientasiya faylı və çərçivə faylı birlikdə seçilməlidir. [NAIF moon_de440_250416.tf](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/satellites/moon_de440_250416.tf) `moon_pa_de440_200625.bpc` ilə uyğunluğu və `MOON_ME_DE440_ME421` çərçivəsini sənədləşdirir. Mövcud Horizons nəticələrini avtomatik əvəz etmir.
8. **Kölgələr:** yalnız lokal 16–21 km sahə ilə kifayətlənməmək. Mövcud horizont yüzlərlə km uzaqdakı relyefi nəzərə alır. Uzaq səth üçün pilləli detal və ya eyni hesablanmış horizont lazımdır; sadələşdirilmiş qrafik kölgə görünürlük hesabını əvəz etmir.
9. **Yoxlama:** xəritə və 3D-də eyni koordinatın üst-üstə düşməsi, mastın hündürlüyü, horizont silueti və keçid anları müqayisə edilməlidir. Mesh sadələşdirməsinin horizont bucağına təsiri ölçülməlidir.

## Tekstura seçimi

[LROC Controlled South Pole Max Pixel Mosaic](https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_POLE_SOUTH_CM_MAX) 1 m/piksel, cənub stereoqrafik proyeksiya və 1 737 400 m radiusla verilir. Əhatəsi üç nöqtənin yerləşdiyi enlikləri daxil edir; ayrıca seçiləcək tile-ların piksel etibarlılığı yoxlanmayıb. LOLA ilə bağlanmış görüntü məhsuludur, amma işıq və kölgə təsirlərindən tam təmizlənmiş albedo deyil. Onu “real foto örtüyü” rejimində göstərmək, hərəkət edən Günəş rejimində isə neytral səth materialı işlətmək daha aydın nəticə verər.

Mövcud `south-pole-hillshade.png` sabit istiqamətdən işıqlandırılmış şəkildir. Onu rəng teksturası kimi istifadə edib yenidən işıqlandırmaq köhnə və yeni kölgələri qarışdırar.

[CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/) uzaq Ay görünüşü üçün faydalıdır. NASA rəng xəritələrinin elmi analiz yox, estetika üçün optimallaşdırıldığını, qütblərdə başqa albedo məlumatı və doldurmalar istifadə edildiyini bildirir. Yaxın qütb səthinin faktiki rəng müşahidəsi kimi təqdim edilməməlidir.

## Hazır modelin seçilməsi

NASA SVS-də `moon_small.glb` topoğrafiyasız rəngli kürədir. `Moon_NASA_LRO_8k_Topo_Small.glb` 77.7 MB topoğrafiyalı alternativdir, amma səhifə qütblərdə sıxılma artefaktını bildirir. Bu səbəbdən yaxın cənub qütbü səhnəsi üçün seçim LOLA-dan hazırlanan lokal modeldir. Hazır kürənin oxları, radiusu və tekstura meridianı import zamanı yoxlanıb normallaşdırılmalıdır; hazır GLB-nin elmi koordinatlara avtomatik uyğun olduğu qəbul edilmir.

Mənbələrdəki müəllif və NASA kreditləri qorunmalıdır. 5 m şəbəkə addımı hər 5 m hüceyrənin ayrıca ölçülməsi və ya 5 m dəqiqlik demək deyil; interpolasiya, ölçmə sıxlığı və xəta qatları nəzərə alınmalıdır.
