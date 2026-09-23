export interface AnioLectivo {
  id: string;
  nombre: string;
  fechaInicio: string;
  fechaFin: string;
  tipoEvaluacion: "trimestral" | "quimestral";
  activo: boolean;
  createdAt: string;
}
export interface PeriodoEvaluacion {
  id: string;
  nombre: string;
  tipo: "trimestre" | "quimestre";
  anioLectivoId: string;
  fechaInicio: string;
  fechaFin: string;
  orden: number;
  activo: boolean;
  createdAt: string;
}
export interface Grado {
  id: string;
  nombre: string;
  paralelo: string;
  anioLectivoId: string;
  activo: boolean;
  orden: number;
  abiertoMatricula?: boolean;
  createdAt: string;
}
// ✅ ESTUDIANTE COMPLETO (con gradoId y anioLectivoId)
export interface Estudiante {
  id: string;
  apellidos: string;
  nombres: string;
  cedula: string;
  gradoId: string;
  anioLectivoId: string;
  activo: boolean;
  createdAt: string;
  updatedAt?: string;
  // ✅ ADAPTACIÓN CURRICULAR (NECE): true = estudiante con adaptación
  conAdaptacion?: boolean;
  // ✅ CAMPOS ADICIONALES DE LA FICHA DE MATRÍCULA
  representantePrincipalId?: string;
  representanteSecundarioId?: string;
  fechaNacimiento?: string;
  sexo?: "M" | "F";
  nacionalidad?: string;
  etnia?: string;
  direccion?: string;
  celular?: string;
  fichaMatricula?: FichaMatricula;
}
export interface Ambito {
  id: string;
  nombre: string;
  gradoId: string;
  orden: number;
  activo: boolean;
  createdAt: string;
}
export interface Destreza {
  id: string;
  nombre: string;
  descripcion: string;
  ambitoId: string;
  gradoId: string;
  orden: number;
  activo: boolean;
  createdAt: string;
}
export interface Calificacion {
  id: string;
  estudianteId: string;
  destrezaId: string;
  periodoId: string;
  anioLectivoId: string;
  nota: number;
  observacion?: string;
  docenteId: string;
  fechaActualizacion: string;
}
export interface Representante {
  id: string;
  cedula: string;
  nombres: string;
  apellidos: string;
  parentesco: "Madre" | "Padre" | "Representante Legal" | "Otro";
  edad?: number;
  estadoCivil?: string;
  instruccion?: string;
  profesion?: string;
  lugarTrabajo?: string;
  telefonos: string[];
  createdAt: string;
}
export interface FichaMatricula {
  convivencia: {
    viveCon: string[];
    totalPersonas: number;
    numeroHermanos: number;
    ordenEntreHermanos: number;
  };
  vivienda: {
    condicion: "Propia" | "Arrendada" | "Anticresis" | "Prestada" | "Compartida" | "Con préstamo" | "Otra";
    tipo: "Casa" | "Departamento" | "Cuarto" | "Otro";
    servicios: string[];
  };
  salud: {
    tieneDiscapacidad: boolean;
    discapacidades: { tipo: string; porcentaje: string; nConadis: string }[];
    condicionMedica: string;
    alergias: string;
    medicamentos: string;
    atencionMedica: "Centro de salud" | "Subcentro de salud" | "Hospital público" | "Clínica privada" | "Otro";
  };
  academicoPrevio: {
    institucionProcedencia: string;
    repitioAnios: boolean;
    aniosRepitidos: string;
  };
}
export interface SolicitudMatricula {
  id: string;
  tipo: "renovacion" | "nuevo";
  estado: "pendiente" | "aprobada" | "rechazada" | "firmada";
  fechaSolicitud: string;
  codigoSeguimiento: string;
  representantePrincipalId: string;
  representanteSecundarioId?: string;
  estudiante: {
    cedula: string;
    nombres: string;
    apellidos: string;
    fechaNacimiento?: string;
    sexo?: "M" | "F";
    nacionalidad?: string;
    edad?: number;
    etnia?: string;
    direccion?: string;
    celular?: string;
  };
  gradoSolicitado: string;
  fichaMatricula: FichaMatricula;
  whatsappEnviado: boolean;
}
// ✅ AppUser con status 'deleted' para usuarios archivados
export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string | null;
  role: "super_admin" | "docente";
  status: "active" | "pending" | "rejected" | "blocked" | "deleted";
  gradosAsignados?: string[];
  tutorDe?: string[];
  nombreDocumento?: string;
  createdAt: string;
}