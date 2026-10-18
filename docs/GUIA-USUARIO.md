# PuntoBase — Guía de usuario

## 1. Instalar la app
- **Android / Chrome / Edge:** aparece el aviso "Instala PuntoBase" → toca **Instalar**.
- **iPhone (Safari):** toca **Compartir** → **Agregar a pantalla de inicio**.
- La primera vez abre la app **con internet** para que guarde el catálogo en el dispositivo.

## 2. Primer uso
1. Abre la app y captura el nombre del negocio y el código de acceso.
2. Cada celular de un empleado se registra con ese código.

## 3. Inventario
- **Inventario → Agregar:** captura nombre, precio, cantidad y mínimo. Con **Escanear** lees el código QR/barras con la cámara.
- **Generar QR** crea un código propio (`PB-XXXXXXXX`) para productos sin código de fábrica; **Etiqueta QR** la imprime. Con **Tomar o elegir foto** agregas una imagen.
- Semáforo: **verde** disponible, **amarillo** pocas piezas (igual o menor al mínimo), **rojo** agotado (no se puede vender).
- Sin internet puedes dar de alta y editar productos **sin variantes**; se envían al reconectar.

## 4. Vender (Punto de venta)
1. Toca el producto o usa **Escanear** para agregarlo al carrito.
2. Elige **Efectivo** (se cobra al instante) o **Transferencia** (queda *Pendiente*, también sin internet). Cuando veas el depósito en tu banco, entra a **Transferencias** y presiona **Confirmar pago**.
- Sin internet la venta se guarda en el dispositivo y se sincroniza sola al volver la señal.

## 5. Cierre de caja
- Efectivo esperado = fondo inicial + ventas en efectivo − gastos.
- Captura el efectivo contado: la app muestra el sobrante o faltante y el desglose de transferencias confirmadas y pendientes.

## 6. Inicio (estadísticas)
- Ventas por día y por hora, Top 10 de productos y alertas de inventario bajo.
- **Lista de compras:** agrupa los productos en amarillo o rojo y la compartes por WhatsApp.
- **Catálogo para clientes:** comparte el enlace `/catalogo` (solo nombre, precio y disponibilidad).

## 7. Notificaciones
- En **Inicio → Notificaciones push** toca **Activar**. Recibirás avisos de producto agotado o con pocas piezas, transferencias por confirmar y cortes de caja con diferencia.
- En iPhone/iPad instala primero la app en la pantalla de inicio (iOS 16.4 o superior).

## 8. Sincronización y avisos
- Barra azul: hay operaciones pendientes. Usa **Sincronizar ahora** si no se envían solas.
- Barra roja: el servidor rechazó una operación; puedes **Reintentar** o **Descartar**.
- Si dos dispositivos editan el mismo producto sin conexión, **gana la última escritura** y la app te avisa qué se sobrescribió.
- Safari/iOS no permite sincronizar con la app cerrada: abre PuntoBase al recuperar internet.
