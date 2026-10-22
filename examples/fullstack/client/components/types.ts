export interface Book {
  id: string;
  title: string;
  author: string;
  year: number;
}

export interface Review {
  reader: string;
  stars: number;
  text: string;
}

export interface Stock {
  copies: number;
  warehouse: string;
}

export interface Warehouse {
  city: string;
  days: number;
}
