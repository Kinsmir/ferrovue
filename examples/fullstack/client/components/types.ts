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
  posted?: Date;
}

export interface Stock {
  copies: number;
  warehouse: string;
  counted?: Date;
}

export interface Warehouse {
  city: string;
  days: number;
}
