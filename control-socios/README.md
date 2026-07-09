# Aplicación de Control de Socios

Esta es la aplicación web para la gestión del centro. Permite administrar socios, actividades, monitores, asistencias e inscripciones. Está construida usando Vite, Vanilla JavaScript y Firebase Firestore.

## Requisitos Previos

El único software necesario para hacer funcionar este proyecto en un equipo local es **Node.js**.
- Descárgalo e instálalo desde [nodejs.org](https://nodejs.org/).
- La instalación de Node.js incluye `npm`, el gestor de paquetes necesario.

## Pasos para la Puesta en Marcha

Sigue estos pasos para arrancar el proyecto en este equipo o en cualquier equipo nuevo:

### 1. Instalar Dependencias
Abre una terminal (o Símbolo del Sistema / PowerShell) en la raíz de esta carpeta (`control-socios`) y ejecuta:

```bash
npm install
```
*Este paso descargará e instalará todas las librerías necesarias. Solo necesitas hacerlo la primera vez.*

### 2. Arrancar la Aplicación
Para iniciar el servidor local, ejecuta el siguiente comando en la misma terminal:

```bash
npm run dev
```

Este comando hará dos cosas:
1. Detectará automáticamente tu dirección IP local en la red (necesario para que funcione el Conector Móvil / Código QR).
2. Levantará un servidor web de desarrollo, habitualmente en el puerto 8000.

### 3. Abrir la Aplicación
Abre tu navegador web y dirígete a la dirección que te proporcionará la terminal (normalmente `http://localhost:8000` o algo similar como `http://192.168.1.XX:8000`).

## Conector Móvil (Monitores)

La aplicación incluye un sistema para que los monitores puedan pasar lista de asistencias desde su teléfono móvil escaneando un código QR en la versión de escritorio.

**Requisito indispensable:** 
Tanto el ordenador donde se ejecuta la aplicación (`npm run dev`) como el dispositivo móvil que escanea el código QR **deben estar conectados a la misma red Wi-Fi o red local**.

## Base de Datos

La aplicación está conectada a **Firebase Firestore** en la nube. No es necesario instalar ni configurar ninguna base de datos local en el ordenador. Toda la información de socios, actividades y asistencias se sincroniza automáticamente con la nube siempre que el equipo tenga conexión a Internet.
