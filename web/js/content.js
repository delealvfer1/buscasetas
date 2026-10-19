/* BuscaSetas · contenidos: fichas de especies, especies mortales, normativa de la zona piloto.
 * BORRADOR sin revisión micológica ni jurídica: hay que revisarlo antes de publicar la app.
 */
(function (global) {
  'use strict';

  const SPECIES_INFO = {
    boletus: {
      title: 'Boletus edulis y B. pinophilus',
      aka: 'Hongo, boleto, calabaza; el pinophilus es el «boletus de pino»',
      look: [
        'Sombrero marrón (edulis) o rojizo granate (pinophilus), de 8 a 25 cm.',
        'Debajo, poros en lugar de láminas: blancos de joven, luego amarillos y verdosos.',
        'Pie grueso y ventrudo, con una redecilla blanca en la parte alta.',
        'Carne blanca que no cambia de color al cortarla.',
      ],
      where: 'Pinares de silvestre, hayedos y rebollares, de 900 a 1.900 m en Pinares. Salen unas dos semanas después de lluvias de 30–40 mm con temperaturas suaves.',
      lookalikes: [
        { name: 'Boletus de pie rojo o poros rojos (Rubroboletus satanas, Suillellus luridus…)', risk: 'tóxicos', tell: 'Poros rojos o anaranjados y carne que se vuelve azul al cortarla. Si tiene rojo debajo o en el pie, descártalo.' },
        { name: 'Tylopilus felleus', risk: 'muy amargo', tell: 'Poros rosados y redecilla oscura en el pie. Uno solo amarga todo el guiso.' },
        { name: 'Caloboletus calopus', risk: 'amargo, indigesto', tell: 'Pie rojo con redecilla y carne que azulea.' },
      ],
    },
    niscalo: {
      title: 'Níscalo (Lactarius deliciosus)',
      aka: 'Robellón, mizcalo',
      look: [
        'Sombrero naranja con círculos concéntricos, hundido en el centro; se mancha de verde al tocarlo o con la edad.',
        'Láminas anaranjadas.',
        'Al cortarlo suelta un líquido (látex) naranja zanahoria.',
        'Pie corto, hueco, con hoyuelos anaranjados.',
      ],
      where: 'Siempre bajo pinos. En Pinares, de octubre a las primeras heladas fuertes, una o dos semanas después de lluvias de 30 mm.',
      lookalikes: [
        { name: 'Lactarius torminosus (falso níscalo)', risk: 'tóxico', tell: 'Sombrero rosado con el borde peludo y látex BLANCO. Crece con abedules.' },
        { name: 'Lactarius chrysorrheus', risk: 'tóxico', tell: 'Látex blanco que se vuelve amarillo en segundos.' },
      ],
      rule: 'Regla práctica: si el látex no es naranja, no es un níscalo.',
    },
    rebozuelo: {
      title: 'Rebozuelo (Cantharellus cibarius)',
      aka: 'Cantarela, angula de monte',
      look: [
        'Todo amarillo yema, sombrero ondulado de 3 a 10 cm.',
        'Debajo no tiene láminas de verdad: pliegues gruesos, bifurcados, que bajan por el pie.',
        'Olor afrutado, a albaricoque. Carne blanca y firme.',
      ],
      where: 'Rebollares, hayedos y pinares con musgo. De junio a noviembre tras lluvias continuadas.',
      lookalikes: [
        { name: 'Omphalotus olearius (seta del olivo)', risk: 'tóxica', tell: 'Crece en grupos sobre madera o raíces, con láminas de verdad, finas y naranjas.' },
        { name: 'Hygrophoropsis aurantiaca (falso rebozuelo)', risk: 'indigesta', tell: 'Naranja intenso, láminas finas y apretadas; frecuente en pinares.' },
      ],
    },
    aereus: {
      title: 'Boletus aereus y B. reticulatus',
      aka: 'Boletus negro y boletus de verano',
      look: [
        'Aereus: sombrero muy oscuro, de negro a bronce. Reticulatus (aestivalis): marrón claro y aterciopelado, a menudo agrietado.',
        'Poros blancos que amarillean; pie con redecilla.',
        'Carne blanca que no cambia al corte.',
      ],
      where: 'Rebollares, encinares y castañares por debajo de 1.300 m, con tormentas de verano o las primeras lluvias de otoño.',
      lookalikes: [
        { name: 'Boletus de poros rojos y carne que azulea', risk: 'tóxicos', tell: 'Mismo aviso que con el boletus de pino: rojo debajo o azul al corte, descártalo.' },
        { name: 'Tylopilus felleus', risk: 'muy amargo', tell: 'Poros rosados.' },
      ],
    },
    cesarea: {
      title: 'Amanita caesarea (oronja)',
      aka: 'Yema de huevo, amanita de los césares',
      look: [
        'Sombrero naranja rojizo, liso, a veces con un trozo blanco de volva encima.',
        'Láminas y pie AMARILLOS.',
        'Volva blanca, grande, en forma de saco en la base.',
      ],
      where: 'Rebollares, encinares y castañares soleados, en verano y principio de otoño tras tormentas con calor.',
      lookalikes: [
        { name: 'Amanita muscaria (matamoscas)', risk: 'tóxica', tell: 'Láminas y pie BLANCOS. Las verrugas blancas del sombrero pueden desaparecer con la lluvia.' },
        { name: 'Amanita phalloides en huevo', risk: 'MORTAL', tell: 'Cerrada, como un huevo, no se pueden distinguir. Nunca recojas amanitas en huevo.' },
      ],
    },
  };

  const DEADLY = [
    { name: 'Amanita phalloides (cicuta verde)', tell: 'Sombrero verde oliva, amarillento o casi blanco; láminas blancas, anillo en el pie y volva en saco. Causa la mayoría de las muertes por setas.' },
    { name: 'Amanita verna y A. virosa', tell: 'Totalmente blancas, con anillo y volva. Se confunden con champiñones y con setas de cardo.' },
    { name: 'Lepiotas pequeñas (L. brunneoincarnata y otras)', tell: 'Menos de 10 cm, sombrero con escamas parduzcas o rosadas. El mismo veneno que la phalloides.' },
    { name: 'Cortinarius orellanus y C. rubellus', tell: 'Color canela o anaranjado, con restos de cortina en el pie. Dañan el riñón y los síntomas aparecen días después.' },
    { name: 'Galerina marginata', tell: 'Pequeña y parda, con anillo, en grupos sobre madera. Se confunde con setas de tocón comestibles.' },
  ];

  const SAFETY = {
    toxPhone: '915620420',
    toxPhoneLabel: '91 562 04 20',
    toxName: 'Servicio de Información Toxicológica (24 h)',
    symptoms: [
      'Si los vómitos o la diarrea empiezan más de 6 horas después de comer setas, ve a urgencias aunque te encuentres mejor después: es el patrón de las especies mortales.',
      'Lleva al hospital los restos de setas, crudas o cocinadas, y avisa a todos los que comieron.',
      'No esperes a tener síntomas si dudas de lo que habéis comido: llama al 112 o al Servicio de Información Toxicológica.',
    ],
    practices: [
      'Usa cesta, no bolsas de plástico: las setas se conservan mejor y sueltan esporas por el camino.',
      'Corta o gira la seta sin arrancar el micelio y tapa el hueco. No rastrilles el suelo.',
      'Deja los ejemplares muy pequeños y los pasados.',
      'Respeta el cupo de kilos del permiso.',
      'Ante cualquier duda, no la comas: llévala a una sociedad micológica.',
    ],
  };

  const LEGAL = {
    verified: '2026-10-19',
    headline: 'En Pinares casi todos los montes públicos y de los pueblos están acotados: lleva permiso.',
    general: [
      'La app aún no tiene los límites de cada monte acotado. Comprueba los carteles en la entrada del monte.',
      'Lo habitual en la zona es un máximo de 5 kg al día con permiso recreativo.',
      'Está prohibido recolectar en zonas donde ese día hay una cacería colectiva autorizada. Mira los carteles en los accesos.',
      'Los montes privados o con cercado necesitan permiso del propietario.',
      'En parques naturales y otros espacios protegidos rigen sus propias normas, que pueden prohibir o limitar la recolección.',
    ],
    acotados: [
      {
        name: 'Parque Micológico Montes de Soria (PMSO-50.001)',
        where: 'Montes de 97 localidades de 72 municipios (70 de Soria y 2 de Burgos).',
        price: 'Permiso general recreativo: 10 € para dos días consecutivos, con un máximo de 5 kg. Empadronados en un pueblo socio: 3 € la temporada.',
        url: 'https://permisos.micologiacyl.es/acotado/montes-de-soria',
        urlLabel: 'Sacar permiso Montes de Soria',
        source: 'permisos.micologiacyl.es y Tu voz en Pinares (12-02-2026)',
      },
      {
        name: 'Acotado Micológico Pinares de Urbión (SO-50.001)',
        where: 'Gestión propia, distinta del Parque Micológico.',
        price: 'Consulta precio y condiciones en los ayuntamientos de la zona.',
        url: null,
        source: 'Tu voz en Pinares (12-02-2026)',
      },
      {
        name: 'Montes de la Junta de Castilla y León en Soria (Micocyl)',
        where: 'Montes propiedad de la Comunidad.',
        price: 'General recreativo: 5 € un día, 8 € dos días, 40 € la temporada.',
        url: 'https://www.micocyl.es/tarifas',
        urlLabel: 'Tarifas Micocyl',
        source: 'micocyl.es/tarifas',
      },
      {
        name: 'Acotados Micocyl de Burgos (por ejemplo Demanda-San Millán)',
        where: 'Sierra de la Demanda y otros montes regulados de Burgos.',
        price: 'Demanda-San Millán: 10 € un día, 15 € dos días, 60 € la temporada; 5 kg al día en recreativo.',
        url: 'https://www.micocyl.es/tarifas',
        urlLabel: 'Tarifas Micocyl',
        source: 'micocyl.es/tarifas',
      },
    ],
  };

  global.SetaContent = { SPECIES_INFO, DEADLY, SAFETY, LEGAL };
})(window);
