/* eslint-disable @typescript-eslint/ban-ts-comment */
import { useCallback, useEffect, useRef, useState } from 'react'
import { PageQuery } from '../service/public'
import * as qs from 'qs'

type useSearchResultProps<LD, QD> = [
  boolean,
  LD,
  QD,
  (searchData?: QD, pagination?: PageQuery) => void,
  string,
]

const SEARCH_QUERY_KEY = '_q'
const SEARCH_CACHE_KEY = 'list_search_query'
type SupportedFormat = 'query' | 'base64'

class SearchOptions<QD> {
  readonly initialSearchData?: QD = {} as QD
  readonly initialPagination?: PageQuery = new PageQuery()
  readonly staticSearchData?: Record<string, any> = {}
  readonly initRequest?: boolean = true
  /**
   * 是否开启查询参数同步，默认false
   * 如果是的话，初始查询会从 url 上query string 读取 并与你设置的初始查询表单数据合并，query string 会覆盖你的表单初始值
   * url-同步到url上
   * copy-提供可复制的数据,当不显示在url上
   */
  readonly sync?: false | 'url' | 'copy' = false
  /**
   * 缓存当前的查询参数,默认值false
   * 缓存时的key为当前 document.location.pathname + SEARCH_CACHE_KEY + cache的值 如果有的话
   */
  readonly cache?: boolean | string = false
  /**
   * 查询参数存储格式，提供给sync和cache读写数据时用
   * 默认base64
   * query 则是正常的query string，不支持复杂数据结构，不支持数据回填时数字格式，因为query读的时候只会读成string
   * 如果设置成base64，会将查询参数json序列化后转成base64编码 以支持复杂数据结构
   */
  readonly storageFormat?: SupportedFormat = 'base64'
}

/**
 * 重用Page页的数据查询逻辑
 * @param queryFunc 接口函数
 * @param initialSearchData 初始查询参数
 * @param staticSearchData 静态查询参数（值不变，每次查询时都会携带）
 * @param initialPagination 初始分页设置
 * @param initRequest 是否在组件首次渲染后请求数据
 * @param sync
 * @param cache
 * @param storageFormat
 * @param isPage
 * @param initialPageData
 * @return [0]-loading状态 [1]-数据 [2]-查询触发函数
 */
function useSearch<LD, QD>(
  queryFunc: (...args: any[]) => Promise<any>,
  {
    initialPagination,
    initialSearchData,
    initRequest,
    staticSearchData,
    sync,
    cache,
    storageFormat = 'base64',
  }: SearchOptions<QD> = new SearchOptions<QD>(),
  initialPageData?: LD,
): useSearchResultProps<LD, QD> {
  const [loading, setLoading] = useState(initRequest)
  const [pageData, setPageData] = useState<LD>(initialPageData)
  /**
   * 搜索数据的覆盖规则
   * sync data 覆盖 cache data 覆盖 initialValues
   * 这是从用户能感知的角度来定的（用户能看见url，能知道缓存的存在，但是未必明确表单硬编码的初始值）
   */
  const _initialSearchData = {
    ...initialSearchData,
    ...(cache ? getFromCache<QD>(cache, storageFormat) : {}),
    ...(sync ? getFromUrl<QD>(storageFormat) : {}),
  }
  const searchDataRef = useRef<QD>(_initialSearchData)
  const paginationRef = useRef<PageQuery>(initialPagination || new PageQuery())
  const query = useRef(queryFunc)
  const staticParams = useRef(staticSearchData || {})
  const storageRef = useRef<string>('')
  const storageFunc = useCallback(
    (formData) => {
      if (sync || cache) {
        storageRef.current = encodeQueryData(formData, storageFormat)
      }
      if (sync === 'url') {
        setToUrl(storageRef.current)
      }
      if (cache) {
        setCache(cache, storageRef.current)
      }
    },
    [storageFormat, sync, cache],
  )
  const searchRef = useRef((searchData?: QD, pagination?: PageQuery) => {
    setLoading(true)
    if (pagination) {
      // 分页在前 是因为 如果 同时传了分页参数和搜索表单参数 则 分页会被覆盖
      // 因为搜索表单数据变化了 意味着重置分页参数
      paginationRef.current = {
        ...paginationRef.current,
        page: paginationRef.current.pageSize === pagination.pageSize ? pagination.page : 1,
        pageSize: pagination.pageSize,
      }
    }
    if (searchData) {
      searchDataRef.current = searchData
      paginationRef.current = { ...paginationRef.current, page: 1 }
    }
    return query
      .current({ ...searchDataRef.current, ...paginationRef.current, ...staticParams.current })
      .then((result) => {
        setPageData(result)
      })
      .finally(() => {
        storageFunc(searchDataRef.current)
        setLoading(false)
      })
  })
  const requestOnDidMount = useRef(initRequest)
  useEffect(() => {
    ;(async () => {
      if (requestOnDidMount.current) {
        await searchRef.current()
      }
    })()
  }, [])
  return [loading, pageData, searchDataRef.current, searchRef.current, storageRef.current]
}

function isUsefulValue(v: any): boolean {
  if (v instanceof Array) {
    return !!v.length
  }
  return v !== undefined && v !== null && v !== ''
}

function encodeQueryData(queryData: Record<string, any>, format: SupportedFormat): string {
  if (queryData) {
    const keys = Object.keys(queryData).filter((k) => isUsefulValue(queryData[k]))
    if (keys.length) {
      const _query = {}
      // @ts-ignore
      keys.forEach((k) => (_query[k] = queryData[k]))
      // TODO 如果是queryString 则再增加类型描述（主要是为了解决 数字变字符串的问题）
      return format == 'base64'
        ? btoa(encodeURIComponent(JSON.stringify(_query)))
        : qs.stringify(queryData, { encode: false })
    }
  }
  return ''
}

function decodeQueryData<FD>(data: string, format: SupportedFormat): FD {
  if (data) {
    // TODO 校验数据完整性
    if (format === 'base64') {
      try {
        return JSON.parse(decodeURIComponent(atob(decodeURIComponent(data))))
      } catch (_) {
        console.error('查询参数不完整，复制链接时请注意')
      }
    } else {
      // TODO 根据类型描述转换类型
      // @ts-ignore
      return qs.parse(decodeURIComponent(data))
    }
  }
  return {} as FD
}

function generateNewUrl(data: string) {
  const url = new URL(document.location.href)
  if (url.searchParams.get(SEARCH_QUERY_KEY)) {
    url.searchParams.delete(SEARCH_QUERY_KEY)
  }
  if (data) {
    // TODO 添加数据完整性校验码
    url.searchParams.set(SEARCH_QUERY_KEY, encodeURIComponent(data))
  }
  return `${document.location.pathname}${url.search}`
}

function setToUrl(data: string) {
  Router.replace(generateNewUrl(data)).then()
}

function getFromUrl<FD>(format: SupportedFormat): FD {
  const url = new URL(document.location.href)
  const queryString = url.searchParams.get(SEARCH_QUERY_KEY)
  return decodeQueryData<FD>(queryString, format)
}

function setCache(prefix: string | true, data: string) {
  sessionStorage.setItem(`${document.location.pathname}_${prefix}_${SEARCH_CACHE_KEY}`, data)
}

function getFromCache<FD>(prefix: string | true, format: SupportedFormat): FD {
  const cacheStr = sessionStorage.getItem(
    `${document.location.pathname}_${prefix}_${SEARCH_CACHE_KEY}`,
  )
  return decodeQueryData<FD>(cacheStr, format)
}

export default useSearch
