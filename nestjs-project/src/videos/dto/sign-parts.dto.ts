import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  Min,
} from 'class-validator';

export class SignPartsDto {
  /** Part numbers to sign (1-based, unique). */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10000)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  partNumbers: number[];
}
