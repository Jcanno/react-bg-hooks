import "reflect-metadata"
import React, { useMemo } from "react"
import { Tooltip } from "antd"
import { isEmpty, renderPrice } from "../toolkit"
import { ClassConstructor } from "../types"
import { PageResult } from "../service/public"
import { EnumDataType } from "../enums"
import moment from "moment"

type PublicFormatOptionType = {
  default?: string
}
/**
 * 支持的格式化类型
 *
 * 添加格式支持的步骤：
 * 1. 确定名称及参数类型 {@see ReadFormatOptionType}
 * 2. 添加默认配置 {@see DEFAULT_FORMAT_OPTIONS}
 * 3. 实现默认工厂函数 {@see DEFAULT_FORMAT_RENDER_FACTORY}
 */
type ReadFormatOptionType = {
  date: { pattern: string } & PublicFormatOptionType // 日期格式化
  datetime: { pattern: string } & PublicFormatOptionType // 日期时间格式化
  number: { digits: number } & PublicFormatOptionType // 数字格式化
  int: { radix: number } & PublicFormatOptionType // 整数格式化
  money: { symbol: string } & PublicFormatOptionType // 金钱格式化(2位小数加千分符)，123,123,123.00
  constant: { origin: EnumDataType<any> } & PublicFormatOptionType // 枚举值反射，并输出name
  join: {
    with: string | string[]
    sep?: string
    format?: keyof Omit<ReadFormatOptionType, "join">
  } & PublicFormatOptionType // 生成类似 name-code 形式的 render
}

type ReadFormatType = keyof ReadFormatOptionType

type ReadFormat<RFT extends ReadFormatType> =
  | RFT
  | [RFT, ReadFormatOptionType[RFT]]

/**
 * 对截断进行扩展
 * 设置截断实现工厂
 * 每个工厂返回一个render函数
 * 截断类型不能嵌套，只能选一个
 */
type EllipsisFactoryOptionType = {
  default: any
  split: { by: string; showIndex: number | "start" | "end" }
}
type EllipsisFactoryType = keyof EllipsisFactoryOptionType
type EllipsisType<EFT extends EllipsisFactoryType> =
  | boolean
  | EFT
  | [EFT, EllipsisFactoryOptionType[EFT]]

type LocalOptions<
  RFT extends ReadFormatType,
  EFT extends EllipsisFactoryType
> = {
  format?: ReadFormat<RFT> // null, 如果设置了 format，会默认提供render方法进行格式化
  amend?: boolean // false, 当值为空时，是否修正（即用默认值替换）
  default?: string // -, 默认值
  group?: string | string[] // 通过设置组，可以选择性是否生成column配置
  ellipsis?: EllipsisType<EFT> // 如果是true 则使用默认截断实现，如果是对象则使用截断工厂来生成render
}

export type ColumnType<
  RFT extends ReadFormatType,
  EFT extends EllipsisFactoryType
> = Omit<BaseTableColumnType<any>, "render" | "ellipsis"> &
  LocalOptions<RFT, EFT>

const COLUMN_META_DATA_KEY = Symbol("table:column")
const DEFAULT_EMPTY_VALUE = "-"

/**
 * 标示列配置的注解
 * 如果参数是字符串，则认为是 title的值
 * @param title
 * @param options
 * @constructor
 */
function Column<RFT extends ReadFormatType, EFT extends EllipsisFactoryType>(
  title: string,
  options?: ColumnType<RFT, EFT>
): PropertyDecorator {
  return (target, key: string) => {
    const _o: ColumnType<RFT, EFT> = { title, dataIndex: key, ...options }
    Reflect.defineMetadata(COLUMN_META_DATA_KEY, _o, target, key)
  }
}

type RenderFactory<OptionType> = (
  option: OptionType[keyof OptionType],
  ...args: any[]
) => BaseTableColumnType<any>["render"]

/**
 * 为每一个支持的格式化类型设置默认的配置和默认的工厂函数
 * 工厂函数用来生成 真正执行格式化的函数(它的入参跟 antd column的render函数一样)
 */
const DEFAULT_FORMAT_OPTIONS: ReadFormatOptionType = {
  date: { pattern: "YYYY-MM-DD" },
  datetime: { pattern: "YYYY-MM-DD HH:mm:ss" },
  number: { digits: 0 },
  int: { radix: 10 },
  money: { symbol: "" },
  constant: { origin: null },
  join: { with: "", sep: "-", format: undefined },
}
const DEFAULT_FORMAT_RENDER_FACTORY: Record<
  ReadFormatType,
  RenderFactory<ReadFormatOptionType>
> = {
  date: (opt: ReadFormatOptionType["date"]) => {
    const _opt = { ...DEFAULT_FORMAT_OPTIONS.date, ...opt }
    return (value) =>
      value ? moment(value).format(_opt.pattern) : _opt.default
  },
  datetime: (opt: ReadFormatOptionType["datetime"]) => {
    const _opt = { ...DEFAULT_FORMAT_OPTIONS.datetime, ...opt }
    return (value) =>
      value ? moment(value).format(_opt.pattern) : _opt.default
  },
  number: (opt: ReadFormatOptionType["number"]) => {
    const _opt = { ...DEFAULT_FORMAT_OPTIONS.number, ...opt }
    return (value) => {
      try {
        return isEmpty(value)
          ? _opt.default
          : Number.parseFloat(value).toFixed(_opt.digits)
      } catch (e) {
        return value
      }
    }
  },
  int: (opt: ReadFormatOptionType["int"]) => {
    const _opt = { ...DEFAULT_FORMAT_OPTIONS.number, ...opt }
    return (value) => {
      try {
        return isEmpty(value)
          ? _opt.default
          : Number.parseInt(value, _opt.radix)
      } catch (e) {
        return value
      }
    }
  },
  money: (opt: ReadFormatOptionType["money"]) => {
    const _opt = { ...DEFAULT_FORMAT_OPTIONS.money, ...opt }
    return (value) => {
      try {
        return isEmpty(value) ? _opt.default : renderPrice(value)
      } catch (e) {
        return value
      }
    }
  },
  constant: (opt: ReadFormatOptionType["constant"]) => {
    const _opt = { ...DEFAULT_FORMAT_OPTIONS.constant, ...opt }
    return (value) => {
      if (_opt.origin) {
        return _opt.origin.valueOf(value).name
      } else {
        return value
      }
    }
  },
  join: (opt: ReadFormatOptionType["join"]) => {
    const {
      format,
      sep,
      with: _with,
    } = { ...DEFAULT_FORMAT_OPTIONS.join, ...opt }
    let keys = _with || []
    if (typeof keys === "string") {
      keys = [keys]
    }
    return (value, record) => {
      const values = [
        value,
        ...(keys as string[]).map((key) => record[key] ?? ""),
      ]
      if (!format) {
        return values.join(sep)
      }
      const formatter = formatGenerate(format, opt)
      return values.map((el) => formatter(el, undefined, undefined)).join(sep)
    }
  },
}

/**
 * 构造格式化函数
 * @param info
 * @param options
 */
const formatGenerate = (
  info: ReadFormat<any>,
  options: ColumnType<any, any>
) => {
  if (!info) return undefined
  const _format: [
    ReadFormatType,
    ReadFormatOptionType[keyof ReadFormatOptionType]
  ] = typeof info === "string" ? [info, null] : info
  return DEFAULT_FORMAT_RENDER_FACTORY[_format[0]](
    _format[1] ? { default: options.default, ..._format[1] } : null
  )
}

/**
 * 截断工厂函数默认配置
 */
const DEFAULT_ELLIPSIS_OPTIONS: EllipsisFactoryOptionType = {
  default: {},
  split: { by: "/", showIndex: "end" },
}

const DEFAULT_ELLIPSIS_RENDER_FACTORY: Record<
  EllipsisFactoryType,
  RenderFactory<EllipsisFactoryOptionType>
> = {
  default: (_, prevRender?: BaseTableColumnType<any>["render"]) => {
    return (value, record, index) => {
      const _d = prevRender ? prevRender(value, record, index) : value
      return (
        <Tooltip placement="topLeft" title={_d}>
          {_d}
        </Tooltip>
      )
    }
  },
  split: (opt, prevRender?: BaseTableColumnType<any>["render"]) => {
    const _opt = { ...DEFAULT_ELLIPSIS_OPTIONS.split, ...opt }
    return (value, record, index) => {
      const _v = prevRender ? prevRender(value, record, index) : value
      if (typeof _v === "string") {
        const values = value.split(_opt.by)
        let _d
        if (_opt.showIndex === "start") {
          // eslint-disable-next-line prefer-destructuring
          _d = values[0]
        }
        if (_opt.showIndex === "end") {
          _d = values[values.length - 1]
        }
        if (typeof _opt.showIndex === "number") {
          _d = values[_opt.showIndex]
        }
        return (
          <Tooltip placement="topLeft" title={value}>
            {_d}
          </Tooltip>
        )
      } else {
        // TODO 怎么报错
      }
    }
  },
}

/**
 * 构造 截断效果的 render
 * @param options
 * @param prevRender
 */
const ellipsisRender = (
  options: ColumnType<any, any>,
  prevRender?: BaseTableColumnType<any>["render"]
): BaseTableColumnType<any>["render"] => {
  let _type: [
    EllipsisFactoryType,
    EllipsisFactoryOptionType[keyof EllipsisFactoryOptionType]
  ] = ["default", null]
  if (options.ellipsis !== true) {
    _type =
      typeof options.ellipsis === "string"
        ? [options.ellipsis, null]
        : options.ellipsis
  } else {
    // eslint-disable-next-line no-param-reassign
    options.ellipsis = { showTitle: false }
  }
  return DEFAULT_ELLIPSIS_RENDER_FACTORY[_type[0]](_type[1], prevRender)
}

type ColumnExtendType<T> = Partial<Record<keyof T, BaseTableColumnType<T>>>

const RESET_LOCAL_OPTIONS: LocalOptions<any, any> = {
  format: undefined,
  amend: undefined,
  default: undefined,
  group: undefined,
}

function groupCheck(
  setting: string | string[] | undefined,
  target: string
): boolean {
  if (!setting) return true
  if (typeof setting === "string") {
    return setting === target
  }
  if (setting instanceof Array) {
    return setting.includes(target)
  }
}

function useColumns<T>(
  Clz?: ClassConstructor<T>,
  additional?: Array<BaseTableColumnType<T>>, // 追加在注解生成的column后面
  extend?: ColumnExtendType<T>, // 覆盖注解生成的column
  group?: string,
  mount?: ColumnExtendType<T>,
  withIndex?: boolean
): Array<BaseTableColumnType<T>> {
  return useMemo(() => {
    const result: Array<BaseTableColumnType<T>> = []
    if (Clz) {
      const target = new Clz()
      Object.keys(target).forEach((k) => {
        const options: ColumnType<any, any> | undefined = Reflect.getMetadata(
          COLUMN_META_DATA_KEY,
          target,
          k
        )
        if (options && groupCheck(options.group, group)) {
          const _options: ColumnType<any, any> = { ...options }
          _options.default = _options.default ?? DEFAULT_EMPTY_VALUE
          /**
           * 以下针对值的 格式化处理， 不涉及 组件渲染
           */
          // 格式化 render
          let _render = formatGenerate(_options.format, _options)
          // 空值候补， 因为前面的数据格式化 已经自带空值候补， 所以这里先判断下
          if (!_render && _options.amend) {
            _render = (value) => (isEmpty(value) ? _options.default : value)
          }
          /**
           * 以下是会使用第三方组件来生成render函数, 这里会涉及 render嵌套，意思是运行时后续的render会使用前面的render的结果
           */
          // 长文本省略
          if (_options.ellipsis) {
            _render = ellipsisRender(_options, _render)
          }
          result.push({
            ..._options,
            ...RESET_LOCAL_OPTIONS,
            render: _render,
            ...extend?.[k as keyof T],
          })
          /**
           * 检查是否有需要挂载在当前列后面的自定义列，有的话就加上
           */
          if (mount?.[k as keyof T]) {
            result.push(mount[k as keyof T])
          }
        }
      })
    }
    if (withIndex) {
      result.unshift({
        title: "序号",
        key: "index",
        width: 50,
        render: (value, record, index) => index + 1,
      })
    }
    if (additional) {
      result.push(...additional)
    }
    return result
  }, [Clz, additional, extend, group, mount, withIndex])
}

function useTable<T>(
  pageData: Partial<PageResult<T>>,
  columns?: Array<BaseTableColumnType<T>>,
  Clz?: ClassConstructor<T>,
  extend?: ColumnExtendType<T>,
  rowKey?: string,
  loading?: boolean,
  search?: (...args: any) => void,
  group?: string,
  mount?: ColumnExtendType<T>,
  withIndex?: boolean // 是否在第一列显示序号
): BaseTableProps<T> {
  const columnsOptions = useColumns(
    Clz,
    columns,
    extend,
    group,
    mount,
    withIndex
  )

  return useMemo(() => {
    return {
      resizable: true,
      dataSource: pageData.list,
      columns: columnsOptions,
      rowKey,
      loading,
      pagination: search && {
        showSizeChanger: true,
        current: pageData.page,
        total: pageData.total,
        pageSize: pageData.pageSize,
        pageSizeOptions: ["30", "50", "100"],
        showTotal: (total) => `共 ${total} 条`,
        onChange: (page, size) => search(null, { page, pageSize: size }),
      },
    }
  }, [
    pageData.list,
    pageData.page,
    pageData.total,
    pageData.pageSize,
    columnsOptions,
    rowKey,
    loading,
    search,
  ])
}

useTable.Column = Column
useTable.useColumns = useColumns
export default useTable
