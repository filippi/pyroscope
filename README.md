# Tabula Caloris — browser frontend

Static HTML, CSS and JavaScript for exploring satellite fire clusters and archive statistics, plus the Burning Earth visualization. This is a source snapshot of the web frontend; it contains no processing pipeline, PHP backend, fire database or videos.

Made for ***CODE4EARTH ECMWF*** pyroscope challenge with data from **CAMS COPERNICUS** service

## Run locally

From this directory:

```sh
python3 -m http.server 8000
```

Open http://localhost:8000/ . Use HTTP hosting rather than opening HTML files directly, because the application uses browser workers and fetch requests. No build step is required.

## Pages and data dependencies

| Page | Purpose | Required data/services |
| --- | --- | --- |
| `index.html` | Live fire map; archive loaded on selecting All | `ARCH/H3TI/LIVE.h3ti`; `ARCH/H3TI/ARCHIVE.h3ti.zst` for history |
| `stats.html` | Interactive archive statistics | `ARCH/H3TI/ARCHIVE.h3ti.zst` only; country boundaries and chart libraries are included |
| `track.html` | Recent indexed activity | LIVE H3TI index |
| `event.html`, `eventadvanced.html` | Individual cluster exploration | Compatible `stfyhotspot.php` API; land-cover features also require `h3vdbinfo.php` and `h3vdcover.php` |
| `analysis.html` | Detailed event analysis | Compatible `stfyhotspot.php` API |
| `burningearth/index.html` | MODIS and geostationary visualization | Separate MP4 assets listed below |

Data requests use relative paths. To run the map and statistics without a backend, place the indexes at the paths above in your served directory. The H3TI record layout is decoded by `compact_index_worker.js` and `stats-worker.js`. Data is not included in this source distribution, so data-dependent pages will report loading errors until it is supplied.

Event pages retain their client-side API calls, but PHP implementations are deliberately omitted. Use a compatible service/reverse proxy at those relative URLs to enable these features. Plain static hosting cannot execute PHP. If adapting the code to a different data origin, that server must allow cross-origin requests (CORS); an HTTPS page also needs HTTPS data endpoints.

Burning Earth expects these files beside its `index.html`:

- `CMB_360_4k_av1_crf38_8bit_20fps_modis_web.mp4`
- `CMB_DAILY_8k_av1_crf38_8bit_24fps_mtgmask_web.mp4`

Some map pages load browser libraries from CDNs and use external map tiles and geocoding services. Their attribution and service terms still apply. The statistics page bundles its libraries and country boundaries locally.


## Credits and license

Developments, algorithms, data structures, deployment and design: **Jean-Baptiste Filippi**, CNRS / University of Corsica. Link with [FET](https://certec.mtg.eebe.upc.edu/fet-eurowest/viewer/) and FRP analysis: **Ronan Paugam**, Certec / UPC Barcelona.

Fire data: NASA FIRMS and IPMA / LSA SAF. Project: Firecaster / Tabula Caloris, with Code for Earth.

The original repository's GNU GPL v3 license is preserved in `LICENSE`. Third-party libraries retain their own licenses and notices; see `vendor/stats/`. Country boundaries are public-domain Natural Earth data. The embedded Three.js distribution in Burning Earth retains its license header. Data and imagery rights are separate from the frontend source license.
