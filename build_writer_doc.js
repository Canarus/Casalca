import fs from 'fs';
import path from 'path';

const assetsDir = path.resolve('control-socios', 'assets');

function getBase64Image(filename) {
  const filePath = path.join(assetsDir, filename);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath).toString('base64');
  }
  return '';
}

const logoBase64 = getBase64Image('logo-canarus.png');
const iconSocios = getBase64Image('icon_socios.png');
const iconCuotas = getBase64Image('icon_cuotas.png');
const iconActividades = getBase64Image('icon_actividades.png');
const iconInscripciones = getBase64Image('icon_inscripciones.png');
const iconAsistencia = getBase64Image('icon_asistencia.png');
const iconMonitores = getBase64Image('icon_monitores.png');
const iconSalas = getBase64Image('icon_salas.png');
const iconTaqueras = getBase64Image('icon_taqueras.png');
const iconCuentas = getBase64Image('icon_cuentas.png');
const iconInformes = getBase64Image('icon_informes.png');

function renderImageFrame(base64Data, name, widthCm, heightCm) {
  if (!base64Data) return '';
  return `<draw:frame draw:name="${name}" text:anchor-type="paragraph" svg:width="${widthCm}cm" svg:height="${heightCm}cm" draw:z-index="0" style:name="Graphics">
    <draw:image>
      <office:binary-data>${base64Data}</office:binary-data>
    </draw:image>
  </draw:frame>`;
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
                 xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
                 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
                 xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
                 xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
                 xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
                 xmlns:xlink="http://www.w3.org/1999/xlink"
                 xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
                 xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"
                 office:version="1.3"
                 office:mimetype="application/vnd.oasis.opendocument.text">
  <office:font-face-decls>
    <style:font-face style:name="Segoe UI" svg:font-family="&apos;Segoe UI&apos;, &apos;Liberation Sans&apos;, sans-serif"/>
    <style:font-face style:name="Segoe UI Semibold" svg:font-family="&apos;Segoe UI Semibold&apos;, sans-serif"/>
  </office:font-face-decls>
  <office:styles>
    <style:default-style style:family="paragraph">
      <style:paragraph-properties fo:line-height="135%" fo:margin-top="0cm" fo:margin-bottom="0.25cm"/>
      <style:text-properties style:font-name="Segoe UI" fo:font-size="11pt" fo:color="#2c3e50"/>
    </style:default-style>
  </office:styles>
  <office:automatic-styles>
    <style:page-layout style:name="pm1">
      <style:page-layout-properties fo:page-width="21.0cm" fo:page-height="29.7cm" fo:margin-top="2.0cm" fo:margin-bottom="2.0cm" fo:margin-left="2.2cm" fo:margin-right="2.2cm"/>
    </style:page-layout>
    <style:style style:name="TitleStyle" style:family="paragraph">
      <style:paragraph-properties fo:margin-top="0.8cm" fo:margin-bottom="0.3cm" fo:text-align="center"/>
      <style:text-properties fo:font-size="22pt" fo:font-weight="bold" fo:color="#1e3a8a"/>
    </style:style>
    <style:style style:name="SubTitleStyle" style:family="paragraph">
      <style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.8cm" fo:text-align="center"/>
      <style:text-properties fo:font-size="13pt" fo:color="#475569" fo:font-style="italic"/>
    </style:style>
    <style:style style:name="Heading1" style:family="paragraph">
      <style:paragraph-properties fo:margin-top="0.6cm" fo:margin-bottom="0.25cm" fo:keep-with-next="always" fo:border-bottom="0.05cm solid #3b82f6" fo:padding-bottom="0.1cm"/>
      <style:text-properties fo:font-size="15pt" fo:font-weight="bold" fo:color="#1e40af"/>
    </style:style>
    <style:style style:name="Heading2" style:family="paragraph">
      <style:paragraph-properties fo:margin-top="0.4cm" fo:margin-bottom="0.15cm" fo:keep-with-next="always"/>
      <style:text-properties fo:font-size="12pt" fo:font-weight="bold" fo:color="#0f766e"/>
    </style:style>
    <style:style style:name="CalloutBox" style:family="paragraph">
      <style:paragraph-properties fo:margin-top="0.3cm" fo:margin-bottom="0.3cm" fo:padding="0.3cm" fo:background-color="#f0fdf4" fo:border-left="0.12cm solid #10b981"/>
      <style:text-properties fo:font-size="10.5pt" fo:color="#065f46"/>
    </style:style>
    <style:style style:name="TableBox" style:family="paragraph">
      <style:paragraph-properties fo:margin-top="0.2cm" fo:margin-bottom="0.2cm" fo:padding="0.25cm" fo:background-color="#f8fafc" fo:border="0.02cm solid #cbd5e1"/>
      <style:text-properties fo:font-size="10pt" fo:color="#334155" style:font-name="Consolas"/>
    </style:style>
    <style:style style:name="CenterAlign" style:family="paragraph">
      <style:paragraph-properties fo:text-align="center"/>
    </style:style>
    <style:style style:name="BoldText" style:family="text">
      <style:text-properties fo:font-weight="bold" fo:color="#0f172a"/>
    </style:style>
  </office:automatic-styles>
  <office:master-styles>
    <style:master-page style:name="Standard" style:page-layout-name="pm1"/>
  </office:master-styles>
  <office:body>
    <office:text>

      <!-- PORTADA Y CABECERA -->
      <text:p style:name="CenterAlign">
        ${renderImageFrame(logoBase64, 'LogoCanarus', 6.5, 2.5)}
      </text:p>
      
      <text:p style:name="TitleStyle">MANUAL DE USUARIO</text:p>
      <text:p style:name="SubTitleStyle">Sistema de Control de Socios y Gestión del Casal (v2.0)</text:p>
      
      <text:p style:name="CalloutBox">
        <text:span style:name="BoldText">Bienvenido/a al Manual de Uso Oficial:</text:span> Este documento está redactado con un lenguaje claro y sencillo para que todo el equipo del casal (personal de recepción, secretaría, junta y monitores) pueda sacar el máximo partido a la aplicación en su labor diaria.
      </text:p>

      <!-- SECCIÓN 1: ACCESO -->
      <text:h text:outline-level="1" style:name="Heading1">1. Acceso al Sistema e Inicio de Sesión</text:h>
      <text:p>Para entrar en el programa, abre el navegador habitual (Chrome, Edge o Firefox) desde el acceso directo del escritorio.</text:p>
      <text:p><text:span style:name="BoldText">Pasos:</text:span></text:p>
      <text:p>1. Introduce tu <text:span style:name="BoldText">Correo electrónico</text:span> y <text:span style:name="BoldText">Contraseña</text:span>.</text:p>
      <text:p>2. Haz clic en el botón azul <text:span style:name="BoldText">"Entrar"</text:span>.</text:p>
      <text:p>3. Se cargará de forma automática el panel principal del Casal.</text:p>

      <!-- SECCIÓN 2: BARRA SUPERIOR -->
      <text:h text:outline-level="1" style:name="Heading1">2. Barra Superior y Controles de Accesibilidad</text:h>
      <text:p>En la parte superior de la pantalla siempre tendrás disponibles los siguientes controles:</text:p>
      <text:p>• <text:span style:name="BoldText">Selector de Tamaño de Letra (A, A+, A++):</text:span> Permite agrandar la tipografía al instante para que cualquier persona pueda leer con total comodidad y sin forzar la vista.</text:p>
      <text:p>• <text:span style:name="BoldText">⚙️ Configuración:</text:span> Acceso a las copias de seguridad e importación de ficheros Excel.</text:p>
      <text:p>• <text:span style:name="BoldText">📱 Conectar Móvil:</text:span> Abre el código QR para que los monitores pasen lista desde su teléfono.</text:p>
      <text:p>• <text:span style:name="BoldText">👥 Contador de Socios:</text:span> Indica el número total de socios registrados en tiempo real.</text:p>
      <text:p>• <text:span style:name="BoldText">🟢 Indicador de Conexión:</text:span> Muestra que el sistema está sincronizado permanentemente con la nube.</text:p>

      <!-- SECCIÓN 3: SOCIOS -->
      <text:h text:outline-level="1" style:name="Heading1">3. Módulo de Socios</text:h>
      <text:p>
        ${renderImageFrame(iconSocios, 'IconSocios', 2.2, 2.2)}
      </text:p>
      <text:p>Este módulo es el censo principal del centro. Permite gestionar todas las fichas personales.</text:p>
      <text:h text:outline-level="2" style:name="Heading2">Dar de alta a un nuevo socio:</text:h>
      <text:p>1. Ve a la pestaña <text:span style:name="BoldText">"Socios"</text:span> y pulsa el botón azul <text:span style:name="BoldText">'+ Nuevo Socio'</text:span>.</text:p>
      <text:p>2. Completa los datos: Número de socio, Nombre, Apellidos, DNI/NIE, Teléfono y Fecha de Nacimiento.</text:p>
      <text:p>3. <text:span style:name="BoldText">Exención por edad:</text:span> Si el socio tiene 90 o más años, el sistema calcula la edad automáticamente y lo marcará como exento de pago de cuota.</text:p>
      <text:p>4. Añade la dirección postal y las observaciones pertinentes (alergias, avisos a familiares, etc.) y pulsa <text:span style:name="BoldText">'Guardar'</text:span>.</text:p>
      <text:p>• <text:span style:name="BoldText">Búsqueda rápida:</text:span> Escribe cualquier nombre, apellido, DNI o número en la casilla de búsqueda para encontrar al socio al instante.</text:p>

      <!-- SECCIÓN 4: CUOTAS -->
      <text:h text:outline-level="1" style:name="Heading1">4. Control de Cuotas Anuales</text:h>
      <text:p>
        ${renderImageFrame(iconCuotas, 'IconCuotas', 2.2, 2.2)}
      </text:p>
      <text:p>Gestiona el cobro anual de las cuotas del casal, el control de morosidad y las exenciones.</text:p>
      <text:p>• <text:span style:name="BoldText">Resumen en pantalla:</text:span> Muestra las tarjetas de <text:span style:name="BoldText">Total Recaudado (€)</text:span>, <text:span style:name="BoldText">Cuotas Pendientes</text:span> y <text:span style:name="BoldText">Exentos (+90 años)</text:span>.</text:p>
      <text:h text:outline-level="2" style:name="Heading2">Cómo registrar el cobro de una cuota:</text:h>
      <text:p>1. Selecciona el año en el desplegable superior.</text:p>
      <text:p>2. Localiza al socio en la tabla y pulsa <text:span style:name="BoldText">'Cobrar / Pagar'</text:span>.</text:p>
      <text:p>3. Elige la forma de pago (Efectivo, Tarjeta o Transferencia) y confirma. El estado cambiará a verde (PAGADO).</text:p>

      <!-- SECCIÓN 5: ACTIVIDADES -->
      <text:h text:outline-level="1" style:name="Heading1">5. Actividades y Talleres</text:h>
      <text:p>
        ${renderImageFrame(iconActividades, 'IconActividades', 2.2, 2.2)}
      </text:p>
      <text:p>Organiza la oferta formativa y lúdica del casal (gimnasia, memoria, baile, informática, manualidades, etc.).</text:p>
      <text:p>• Para crear un taller, pulsa <text:span style:name="BoldText">'+ Nueva Actividad'</text:span>, introduce el nombre, asigna el monitor responsable, la sala donde se impartirá, los días y horas semanales y el aforo máximo de alumnos.</text:p>

      <!-- SECCIÓN 6: INSCRIPCIONES -->
      <text:h text:outline-level="1" style:name="Heading1">6. Inscripciones y Listas de Espera</text:h>
      <text:p>
        ${renderImageFrame(iconInscripciones, 'IconInscripciones', 2.2, 2.2)}
      </text:p>
      <text:p>Matricula a los socios en los cursos disponibles.</text:p>
      <text:p>• Al apuntar a un socio mediante <text:span style:name="BoldText">'+ Nueva Inscripción'</text:span>, si la actividad dispone de vacantes quedará en estado <text:span style:name="BoldText">Admitido</text:span>. Si el aforo está completo, el sistema lo colocará automáticamente en <text:span style:name="BoldText">Lista de Espera</text:span>.</text:p>

      <!-- SECCIÓN 7: ASISTENCIA -->
      <text:h text:outline-level="1" style:name="Heading1">7. Asistencia y Pasar Lista (PC y Móvil QR)</text:h>
      <text:p>
        ${renderImageFrame(iconAsistencia, 'IconAsistencia', 2.2, 2.2)}
      </text:p>
      <text:p>El control de asistencia se puede realizar de dos formas muy cómodas:</text:p>
      <text:p>1. <text:span style:name="BoldText">Desde el ordenador:</text:span> En la pestaña 'Asistencia', selecciona la clase y marca con un clic quién está Presente o Ausente.</text:p>
      <text:p>2. <text:span style:name="BoldText">Desde el teléfono del monitor (QR):</text:span> Pulsa 'Conectar Móvil' en el ordenador. El monitor escanea el código QR con su móvil, introduce su PIN de 4 dígitos y pasa lista tocando la pantalla táctil de su teléfono.</text:p>

      <!-- SECCIÓN 8: MONITORES -->
      <text:h text:outline-level="1" style:name="Heading1">8. Monitores y Personal</text:h>
      <text:p>
        ${renderImageFrame(iconMonitores, 'IconMonitores', 2.2, 2.2)}
      </text:p>
      <text:p>Registra al equipo docente y dinamizador. Cada monitor cuenta con su nombre, teléfono, especialidad y un <text:span style:name="BoldText">PIN secreto de 4 dígitos</text:span> para autenticarse al pasar lista desde el móvil.</text:p>

      <!-- SECCIÓN 9: SALAS -->
      <text:h text:outline-level="1" style:name="Heading1">9. Salas y Espacios</text:h>
      <text:p>
        ${renderImageFrame(iconSalas, 'IconSalas', 2.2, 2.2)}
      </text:p>
      <text:p>Gestiona las dependencias del casal (Salón de Actos, Gimnasio, Sala de Billar, Aula 1...) y asegura el cumplimiento del aforo máximo reglamentario.</text:p>

      <!-- SECCIÓN 10: TAQUERAS -->
      <text:h text:outline-level="1" style:name="Heading1">10. Taqueras de Billar</text:h>
      <text:p>
        ${renderImageFrame(iconTaqueras, 'IconTaqueras', 2.2, 2.2)}
      </text:p>
      <text:p>Control de casilleros de billar para socios aficionados. Muestra visualmente las taqueras libres (verde) y ocupadas (rojo con el nombre del socio) con opciones de asignación y liberación en un clic.</text:p>

      <!-- SECCIÓN 11: CUENTAS -->
      <text:h text:outline-level="1" style:name="Heading1">11. Cuentas y Tesorería</text:h>
      <text:p>
        ${renderImageFrame(iconCuentas, 'IconCuentas', 2.2, 2.2)}
      </text:p>
      <text:p>Libro diario contable para registrar todos los Ingresos (cuotas, donaciones, lotería) y Gastos (material, suministros, reparaciones) con cálculo automático del saldo total en caja.</text:p>

      <!-- SECCIÓN 12: EXCURSIONES -->
      <text:h text:outline-level="1" style:name="Heading1">12. Excursiones y Autobuses</text:h>
      <text:p>Organización de salidas y viajes: creación del viaje, configuración de autocares, plano interactivo para asignar butacas a cada socio, control de pago del viaje y exportación a PDF para el conductor.</text:p>

      <!-- SECCIÓN 13: INFORMES -->
      <text:h text:outline-level="1" style:name="Heading1">13. Informes Oficiales y Listados</text:h>
      <text:p>
        ${renderImageFrame(iconInformes, 'IconInformes', 2.2, 2.2)}
      </text:p>
      <text:p>Genera en segundos e imprime documentos oficiales en PDF o Excel: Censo de socios, Listado de morosos, Listas de clase por taller y Hojas de firmas en blanco.</text:p>

      <!-- SECCIÓN 14: ESTADÍSTICAS -->
      <text:h text:outline-level="1" style:name="Heading1">14. Estadísticas del Centro</text:h>
      <text:p>Muestra gráficos visuales sobre la actividad del casal: distribución de edades de los socios, talleres más demandados y evolución de asistencia y cobros.</text:p>

      <!-- SECCIÓN 15: COPIAS DE SEGURIDAD -->
      <text:h text:outline-level="1" style:name="Heading1">15. Copias de Seguridad (Backups)</text:h>
      <text:p style:name="CalloutBox">
        <text:span style:name="BoldText">Protección de Datos:</text:span> Aunque los datos se guardan en la nube, es muy aconsejable pulsar en <text:span style:name="BoldText">'⚙️ Configuración'</text:span> > <text:span style:name="BoldText">'Descargar Copia de Seguridad'</text:span> una vez al mes para guardar un archivo de respaldo en un lápiz de memoria USB o disco externo.
      </text:p>

      <!-- SECCIÓN 16: PREGUNTAS FRECUENTES -->
      <text:h text:outline-level="1" style:name="Heading1">16. Preguntas Frecuentes</text:h>
      <text:p>• <text:span style:name="BoldText">¿Cómo cambio el tamaño de letra?</text:span> Haz clic en los botones A, A+ o A++ de la barra superior.</text:p>
      <text:p>• <text:span style:name="BoldText">¿Por qué no cobra la cuota a un socio de 92 años?</text:span> Porque la aplicación aplica automáticamente la exención de pago a los mayores de 90 años.</text:p>
      <text:p>• <text:span style:name="BoldText">¿Qué hacer si el monitor no puede escanear el QR?</text:span> Asegúrate de que el teléfono móvil del monitor esté conectado a la misma red Wi-Fi del centro.</text:p>

    </office:text>
  </office:body>
</office:document>`;

fs.writeFileSync('MANUAL_DE_USO.fodt', xml, 'utf8');
console.log('MANUAL_DE_USO.fodt creado con éxito.');
