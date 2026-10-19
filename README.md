# BuscaSetas (prototipo)

App Android para saber **dónde y cuándo es probable que salgan setas** en Pinares de Soria y Burgos, y **si hace falta permiso** para recogerlas. Es el prototipo de validación de la temporada de otoño de 2026.

## Instalar en el móvil

1. En el móvil Android, abre <https://github.com/delealvfer1/buscasetas/releases/latest> y descarga `BuscaSetas.apk`.
2. Ábrelo. Android pedirá permiso para instalar apps de origen desconocido (desde el navegador o la app de archivos): concédelo.
3. Al abrir la app, acepta el permiso de ubicación.

Las versiones nuevas se instalan encima de la anterior sin perder los puntos ni el diario.

## Qué hace

- **Mapa de probabilidad** por cuadrícula de 1 km para boletus (edulis/pinophilus), níscalo, rebozuelo, boletus de verano y oronja, hoy y los próximos 7 días.
- **Ficha de cada cuadrícula** con el porqué: lluvia en la ventana que importa, temperaturas, heladas, tipo de bosque, altitud y temporada, más la gráfica de lluvia diaria.
- **Semáforo legal** junto a cada predicción y página de permisos de la zona (Montes de Soria, Micocyl…).
- **GPS, volver al coche** con brújula, hora de puesta de sol y batería (funciona sin cobertura).
- **Puntos privados** y **diario de salidas** (con y sin setas) con el porcentaje de acierto del modelo y exportación a CSV.
- **Fichas de especies** con sus confusiones peligrosas y especies mortales, y botones de 112 y Servicio de Información Toxicológica.
- **Mapas sin cobertura**: descarga del mapa topográfico del IGN para la zona que tengas en pantalla.

## Cómo funciona

`P = 100 · H · M · T`

- **H, hábitat**: cobertura de coníferas y frondosas en la celda (Copernicus HRL Dominant Leaf Type 2018, 10 m) y altitud (Copernicus DEM vía Open-Meteo).
- **M, meteorología**: lluvia acumulada entre 1 y 3 semanas antes (según especie), máximas medias de la última semana, heladas y sequía reciente (Open-Meteo, 30 días pasados + 7 de previsión, interpolado a cada celda con corrección por altitud).
- **T, temporada**: curva por especie para la comarca.

Los umbrales están en `web/js/model.js` y son hipótesis de partida: el diario de salidas sirve para calibrarlos.

## Estructura

| Carpeta | Contenido |
|---|---|
| `web/` | La app (HTML/CSS/JS sin dependencias). Se puede probar en el navegador con `python3 -m http.server` dentro de `web/`. |
| `app/` | Contenedor Android (WebView) en Java. |
| `pipeline/` | Script que genera `web/data/cells.js` (hábitat, altitud, municipios, espacios protegidos). |
| `.github/workflows/` | Compilación automática: genera los datos, compila el APK y lo publica en *Releases*. |

El `web/data/cells.js` del repositorio contiene **datos de prueba**; la compilación lo sustituye por los datos reales.

## Avisos

- Prototipo sin revisión micológica ni jurídica. La app **nunca** confirma que una seta sea comestible.
- La normativa se recopiló el 19-10-2026 y puede cambiar; aún no están cargados los límites de cada monte acotado.
- La clave de firma del APK (`app/buscasetas.jks`) es solo para el prototipo. Para Google Play hará falta una clave privada.

Datos: © Copernicus Land Monitoring Service / EEA, © colaboradores de OpenStreetMap (ODbL), Open-Meteo.com (CC BY 4.0), © IGN (CC BY 4.0).
